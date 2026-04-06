const { rev_recognition_allocation_schema } = require("./schema_rev_recognition_allocation_data");

const rev_recognition_allocation_history_schema = [
  // ID Fields
  {
    name: "as_of_snapshot_date_mtn",
    mode: "NULLABLE",
    type: "DATETIME",
    description: "Snapshot datetime mtn",
    fields: []
  },
  {
    name: "snapshot_version",
    mode: "NULLABLE",
    type: "STRING",
    description: "Snapshot version",
    fields: []
  },

  rev_recognition_allocation_schema
  
];

module.exports = {
  rev_recognition_allocation_history_schema
};
