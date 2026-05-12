                 const { Client } = require('pg');

async function main() {
  const client = new Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
  await client.connect();

  const cols = await client.query(
    `select column_name, data_type, is_nullable, column_default
     from information_schema.columns
     where table_schema = 'public' and table_name = 'complaints'
     order by ordinal_position`
  );
  const count = await client.query(`select count(*)::int as total from complaints`);
  const categories = await client.query(`select id, code, name, is_active from complaint_categories order by code`);

  console.log(JSON.stringify({ columns: cols.rows, totalComplaints: count.rows[0].total, categories: categories.rows }, null, 2));
  await client.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
