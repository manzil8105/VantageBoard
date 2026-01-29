const mysql = require("mysql2");

//  connection to the database
const db = mysql.createConnection({
  host: "localhost",
  user: "root",
  password: "",
  database: "kanban_app",
});

db.connect((err) => {
  if (err) {
    console.error("Database Connection Failed: " + err.stack);
    return;
  }
  console.log("Database Connected successfully to 'kanban_app'");
});

module.exports = db;
