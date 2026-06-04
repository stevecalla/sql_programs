const dotenv = require('dotenv');
dotenv.config({ path: "./.env" });

const jsforce = require("jsforce");
const fs = require("fs");
const csv = require("fast-csv");

function norm(value) {
  return (value || "").trim().toUpperCase();
}

function compositeZip(row) {
  const billing = (row.BillingPostalCode || "").trim();
  const mailing = (row.PersonMailingPostalCode || "").trim();

  return billing !== "" ? billing : mailing;
}

function makeKey(row) {
  return [
    norm(row.LastName),
    norm(row.FirstName),
    norm(row.cfg_Gender_Identity__pc),
    norm(row.PersonBirthdate),
    norm(compositeZip(row)),
  ].join("|");
}

async function main() {
  const conn = new jsforce.Connection({
    loginUrl: process.env.SF_LOGIN_URL || "https://test.salesforce.com",
  });

  await conn.login(
    process.env.SF_USERNAME,
    process.env.SF_PASSWORD + process.env.SF_SECURITY_TOKEN
  );

  console.log(conn);

//   const soql = `
//     SELECT Id,
//         LastName,
//         FirstName,
//         cfg_Member_Number__pc,
//         cfg_Gender_Identity__pc,
//         PersonBirthdate,
//         BillingPostalCode,
//         PersonMailingPostalCode
//     FROM Account
//     WHERE FirstName != null
//     AND LastName != null
//   `;

//   const groups = new Map();

//   const result = await conn.query(soql).scanAll();

//   for (const row of result.records) {
//     const key = makeKey(row);

//     if (!groups.has(key)) {
//       groups.set(key, {
//         LastName: row.LastName,
//         FirstName: row.FirstName,
//         cfg_Gender_Identity__pc: row.cfg_Gender_Identity__pc,
//         PersonBirthdate: row.PersonBirthdate,
//         CompositeZip: compositeZip(row),
//         duplicate_count: 0,
//         record_ids: [],
//         member_numbers: [],
//       });
//     }

//     const group = groups.get(key);
//     group.duplicate_count += 1;
//     group.record_ids.push(row.Id);

//     if (row.cfg_Member_Number__pc) {
//       group.member_numbers.push(row.cfg_Member_Number__pc);
//     }
//   }

//   const duplicates = [...groups.values()]
//     .filter((g) => g.duplicate_count > 1)
//     .sort((a, b) => b.duplicate_count - a.duplicate_count);

//   const ws = fs.createWriteStream("account_duplicates.csv");

//   csv.write(duplicates, { headers: true }).pipe(ws);

  console.log(`Total records scanned: ${result.records.length}`);
  console.log(`Duplicate groups found: ${duplicates.length}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});