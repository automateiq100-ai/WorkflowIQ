const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_KEY
);

async function cleanupDB() {
    console.log('Starting DB cleanup...');

    // Delete rows with summaries or embeddings
    const { error: deleteError } = await supabase
        .from('cases')
        .delete()
        .neq('summary', null)
        .neq('embedding', null);

    if (deleteError) {
        console.error('Error deleting rows:', deleteError);
        return;
    }

    console.log('Deleted rows with summaries/embeddings.');

    // Run raw SQL for DDL
    const { error: sqlError } = await supabase.rpc('exec_sql', {
        sql: `
ALTER TABLE cases DROP COLUMN IF EXISTS summary;
ALTER TABLE cases DROP COLUMN IF EXISTS summarized_at;
ALTER TABLE cases DROP COLUMN IF EXISTS embedding;
ALTER TABLE cases DROP COLUMN IF EXISTS embedded_at;
ALTER TABLE cases DROP COLUMN IF EXISTS headnote_embedding;
ALTER TABLE cases DROP COLUMN IF EXISTS headnote_embedded_at;
        `
    });

    if (sqlError) {
        console.error('Error running SQL:', sqlError);
        console.log('You may need to run the SQL manually in Supabase dashboard.');
    } else {
        console.log('Dropped unused columns.');
    }

    console.log('Cleanup complete.');
}

cleanupDB().catch(console.error);