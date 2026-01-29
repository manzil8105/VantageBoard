const express = require("express");
const router = express.Router();
const db = require("../db");
const bcrypt = require("bcrypt");

// REGISTER
router.post("/register", async (req, res) => {
  const { username, email, password } = req.body;

  if (!username || !email || !password) {
    return res.json({ title: "Error", msg: "All fields are required." });
  }

  const hashed = await bcrypt.hash(password, 10);

  const sql = "INSERT INTO users (username, email, password) VALUES (?,?,?)";

  db.query(sql, [username, email, hashed], (err) => {
    if (err) {
      return res.json({
        title: "Registration Failed",
        msg: "Username or Email already exists!",
      });
    }
    return res.json({ title: "Success", msg: "Account Created Successfully!" });
  });
});

// LOGIN
router.post("/login", (req, res) => {
  const { email, password } = req.body;

  const sql = "SELECT * FROM users WHERE email=?";

  db.query(sql, [email], async (err, data) => {
    if (err || data.length === 0) {
      return res.json({ title: "Wrong Information", msg: "Try Again!!" });
    }

    const user = data[0];
    const match = await bcrypt.compare(password, user.password);

    if (!match) {
      return res.json({ title: "Wrong Information", msg: "Try Again!!" });
    }

    return res.json({ title: "Success", msg: "Login Successful!" });
  });
});

module.exports = router;
