"""APScheduler jobs (Asia/Kolkata timezone).

Jobs at 09:00 IST:
- daily_followup_job: per consented client × pending doc, generate Hinglish reminder, send.
- ca_digest_job: one summary message to the CA (overdue + T-1 clients).

Retention jobs at 02:00 IST:
- chat_retention_job: soft-delete messages older than 365 days.
- doc_retention_job: soft-delete documents past retention_until.
"""
from __future__ import annotations

import os
from datetime import date, datetime, timezone

from apscheduler.schedulers.asyncio import AsyncIOScheduler
from apscheduler.triggers.cron import CronTrigger
from loguru import logger

from agents.shalini_client import generate_client_message
from tools import db_tools, telegram_tools
from tools.supabase_client import supa


_scheduler: AsyncIOScheduler | None = None


def _today_str() -> str:
    return date.today().isoformat()


# ---------- daily_followup_job ---------- #

async def daily_followup_job():
    """For each owner, for each consented client × pending doc due in window,
    send a Hinglish follow-up.
    """
    logger.info("daily_followup_job: starting")
    today = date.today().isoformat()

    def _list_firms():
        return supa().table("practiceiq_firms").select("id").execute()

    res = await db_tools._run(_list_firms)
    firm_ids = [r["id"] for r in (res.data or [])]

    sent = 0
    for firm_id in firm_ids:
        firm = await db_tools.get_firm_settings(firm_id)
        clients_res = await db_tools._run(
            lambda fid=firm_id: supa()
            .table("practiceiq_clients")
            .select("id, name, followup_broadcast")
            .eq("firm_id", fid)
            .execute()
        )
        for client in clients_res.data or []:
            pending = await db_tools.get_pending_docs(client["id"])
            if not pending:
                continue
            broadcast = bool(client.get("followup_broadcast"))
            if broadcast:
                targets = await db_tools.list_consented_accounts(client["id"])
            else:
                primary = await db_tools.get_primary_account(client["id"])
                targets = [primary] if primary else []
            if not targets:
                continue

            # Filter to docs whose followup_start_date <= today.
            in_window = [d for d in pending if (d.get("followup_start_date") or "9999-99-99") <= today]
            if not in_window:
                continue

            for doc in in_window:
                if await db_tools.followup_sent_today(client["id"], doc["doc_type"], period=doc.get("period")):
                    continue
                count = await db_tools.get_followup_count(client["id"], doc["doc_type"], period=doc.get("period"))
                deadline = doc.get("deadline_date")
                days = _days_to_deadline(deadline)
                msg = await generate_client_message(
                    client={"name": client["name"]},
                    trigger_context="scheduled_followup",
                    pending_docs=[doc],
                    days_to_deadline=days,
                    followup_number=count,
                    firm_name=firm["firm_name"],
                    custom_system=firm["client_agent_prompt"],
                )
                # Fan out.
                ext_ids = []
                for t in targets:
                    try:
                        ext = await telegram_tools.send_text(t["telegram_chat_id"], msg)
                        ext_ids.append(str(ext))
                    except Exception as e:
                        logger.warning(f"followup send failed client={client['id']} chat={t['telegram_chat_id']}: {e}")

                # One log row regardless of fan-out count.
                await db_tools.log_followup(
                    client_id=client["id"],
                    firm_id=firm_id,
                    doc_type=doc["doc_type"],
                    period=doc.get("period"),
                    urgency_level=_urgency_label(days),
                    message_text=msg,
                    external_message_id=",".join(ext_ids) or None,
                )
                # Save to messages too.
                await db_tools.save_message(
                    client_id=client["id"],
                    firm_id=firm_id,
                    sender="shalini",
                    message_type="text",
                    raw_text=msg,
                    doc_type=doc["doc_type"],
                    period=doc.get("period"),
                )
                sent += 1
    logger.info(f"daily_followup_job: sent {sent} reminders")


def _days_to_deadline(iso_date: str | None) -> int:
    if not iso_date:
        return 5
    try:
        dl = datetime.strptime(iso_date, "%Y-%m-%d").date()
        return (dl - date.today()).days
    except ValueError:
        return 5


def _urgency_label(days: int) -> str:
    if days >= 4:
        return "friendly"
    if days >= 2:
        return "warm"
    if days >= 0:
        return "urgent"
    return "escalation"


# ---------- ca_digest_job ---------- #

async def ca_digest_job():
    logger.info("ca_digest_job: starting")
    def _q():
        return (
            supa()
            .table("practiceiq_settings")
            .select("firm_id, ca_telegram_chat_id")
            .not_.is_("ca_telegram_chat_id", "null")
            .execute()
        )
    res = await db_tools._run(_q)
    for row in res.data or []:
        firm_id = row["firm_id"]
        try:
            ca_chat = int(row["ca_telegram_chat_id"])
        except (ValueError, TypeError):
            continue
        items = await db_tools.get_all_pending_clients(firm_id)
        if not items:
            continue
        lines = [f"📋 Pending docs digest — {date.today().isoformat()}"]
        for it in items[:25]:
            count = len(it["pending"])
            lines.append(f"- {it['client_name']}: {count} pending")
        if len(items) > 25:
            lines.append(f"... (+{len(items) - 25} more clients)")
        try:
            await telegram_tools.send_ca_notification(ca_chat, "\n".join(lines))
        except Exception as e:
            logger.warning(f"ca_digest send failed for firm={firm_id}: {e}")


# ---------- retention jobs ---------- #

async def chat_retention_job():
    logger.info("chat_retention_job: starting")
    def _q():
        return supa().rpc("noop", {}).execute()  # placeholder; real cleanup left for V2

    # For V1, do a simple delete of messages older than 365 days.
    cutoff = (datetime.now(timezone.utc).date()).replace(year=datetime.now(timezone.utc).year - 1)
    cutoff_iso = cutoff.isoformat()

    def _delete():
        return (
            supa()
            .table("practiceiq_messages")
            .delete()
            .lt("timestamp", cutoff_iso)
            .execute()
        )

    try:
        res = await db_tools._run(_delete)
        logger.info(f"chat_retention_job: removed {len(res.data or [])} rows older than {cutoff_iso}")
    except Exception as e:
        logger.warning(f"chat_retention_job failed: {e}")


async def doc_retention_job():
    logger.info("doc_retention_job: starting")
    today = date.today().isoformat()

    def _soft_delete():
        return (
            supa()
            .table("practiceiq_documents")
            .update({"deleted_at": datetime.now(timezone.utc).isoformat()})
            .lte("retention_until", today)
            .is_("deleted_at", "null")
            .execute()
        )

    try:
        res = await db_tools._run(_soft_delete)
        logger.info(f"doc_retention_job: soft-deleted {len(res.data or [])} expired documents")
    except Exception as e:
        logger.warning(f"doc_retention_job failed: {e}")


# ---------- Public entry ---------- #

def start_scheduler() -> AsyncIOScheduler:
    global _scheduler
    if _scheduler is not None:
        return _scheduler
    tz = "Asia/Kolkata"
    sched = AsyncIOScheduler(timezone=tz)
    sched.add_job(daily_followup_job, CronTrigger(hour=9, minute=0, timezone=tz), id="daily_followup", replace_existing=True)
    sched.add_job(ca_digest_job, CronTrigger(hour=9, minute=10, timezone=tz), id="ca_digest", replace_existing=True)
    sched.add_job(chat_retention_job, CronTrigger(hour=2, minute=0, timezone=tz), id="chat_retention", replace_existing=True)
    sched.add_job(doc_retention_job, CronTrigger(hour=2, minute=15, timezone=tz), id="doc_retention", replace_existing=True)

    # Optional Gmail poll (Phase B). Imported lazily so backend boots even without Gmail set up.
    if os.environ.get("GMAIL_CLIENT_ID") and os.environ.get("GMAIL_CLIENT_SECRET"):
        try:
            from integrations.gmail import poll_all_firms  # type: ignore
            sched.add_job(poll_all_firms, "interval", minutes=5, id="gmail_poll", replace_existing=True)
            logger.info("Gmail poll job scheduled (5 min interval)")
        except Exception as e:
            logger.info(f"Gmail integration not available: {e}")

    sched.start()
    _scheduler = sched
    logger.info(f"scheduler started ({tz})")
    return sched
