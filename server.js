const express = require("express");
const cors = require("cors");
const mysql = require("mysql2");
const app = express();

app.use(cors());
app.use(express.json());

const db = mysql.createConnection({
  host: "localhost",
  user: "root",
  password: "",
  database: "kanban_app",
});

db.connect((err) => {
  if (err) console.error("DB Connection Error: " + err.stack);
  else console.log("Connected to database");
});

//  AUTHENTICATION
app.post("/register", (req, res) => {
  const { username, email, password } = req.body;
  db.query(
    "INSERT INTO users (username, email, password, created_at) VALUES (?, ?, ?, NOW())",
    [username, email, password],
    (err) => {
      if (err)
        return res
          .status(500)
          .json({ title: "Error", msg: "Email already exists." });
      res.json({ title: "Success", msg: "Account created!" });
    },
  );
});

app.post("/login", (req, res) => {
  const { email, password } = req.body;
  db.query(
    "SELECT * FROM users WHERE email = ? AND password = ?",
    [email, password],
    (err, results) => {
      if (results.length > 0) res.json({ title: "Success", user: results[0] });
      else
        res.status(401).json({ title: "Failed", msg: "Invalid credentials." });
    },
  );
});

app.post("/update-profile", (req, res) => {
  const { userId, newName } = req.body;
  db.query(
    "UPDATE users SET username = ? WHERE id = ?",
    [newName, userId],
    (err) => res.json({ msg: "Updated" }),
  );
});

app.post("/change-password", (req, res) => {
  const { userId, currentPassword, newPassword } = req.body;
  db.query(
    "SELECT password FROM users WHERE id = ?",
    [userId],
    (err, results) => {
      if (results.length === 0 || results[0].password !== currentPassword)
        return res.status(401).json({ msg: "Incorrect current password" });
      db.query(
        "UPDATE users SET password = ? WHERE id = ?",
        [newPassword, userId],
        () => res.json({ msg: "Password Changed" }),
      );
    },
  );
});

//  DASHBOARD & SEARCH

// FIX: Added Search Route [cite: 14, 15]
app.get("/search", (req, res) => {
  const { userId, q } = req.query;
  const term = `%${q}%`;

  // Search Boards
  const sql = `
        SELECT DISTINCT b.id, b.boardtitle as title, 'board' as type 
        FROM boards b
        LEFT JOIN board_members bm ON b.id = bm.board_id
        WHERE (b.user_id = ? OR bm.user_id = ?) AND b.boardtitle LIKE ?
        LIMIT 10`;

  db.query(sql, [userId, userId, term], (err, results) => {
    if (err) return res.status(500).json(err);
    res.json(results);
  });
});

// FIX: Enhanced Stats for Board Cards
app.get("/boards/:userId", (req, res) => {
  const sql = `
    SELECT DISTINCT b.id, b.boardtitle AS title, b.created_at,
    (SELECT COUNT(*) FROM tasks t JOIN columns c ON t.column_id = c.id WHERE c.board_id = b.id) as total_tasks,
    (SELECT COUNT(*) FROM tasks t JOIN columns c ON t.column_id = c.id WHERE c.board_id = b.id AND c.title != 'Done') as remaining_tasks,
    (SELECT COUNT(*) FROM tasks t JOIN columns c ON t.column_id = c.id WHERE c.board_id = b.id AND c.title = 'In Progress') as in_progress_tasks,
    (SELECT COUNT(*) FROM tasks t JOIN columns c ON t.column_id = c.id WHERE c.board_id = b.id AND c.title = 'Under Review') as under_review_tasks
    FROM boards b 
    LEFT JOIN board_members bm ON b.id = bm.board_id
    WHERE b.user_id = ? OR bm.user_id = ?`;

  db.query(sql, [req.params.userId, req.params.userId], (err, results) => {
    if (err) return res.status(500).json(err);
    res.json(results);
  });
});

// Board Deletion with Warning Logic
app.delete("/boards/:id", (req, res) => {
  const boardId = req.params.id;
  // Check for incomplete tasks first
  const checkSql = `
        SELECT COUNT(*) as count FROM tasks t 
        JOIN columns c ON t.column_id = c.id 
        WHERE c.board_id = ? AND c.title != 'Done'`;

  db.query(checkSql, [boardId], (err, results) => {
    if (err) return res.status(500).json(err);
    const incomplete = results[0].count;

    // If force parameter is not present and there are tasks, warn
    if (incomplete > 0 && req.query.force !== "true") {
      return res.status(409).json({
        warning: true,
        msg: `Warning: This board has ${incomplete} incomplete tasks. Are you sure?`,
        requiresConfirmation: true,
      });
    }

    db.query("DELETE FROM boards WHERE id = ?", [boardId], (err) => {
      if (err) return res.status(500).json(err);
      res.json({ msg: "Board permanently deleted" });
    });
  });
});

app.post("/create-board", (req, res) => {
  const { userId, title, tags, description, links } = req.body;
  db.query(
    "INSERT INTO boards (user_id, boardtitle, description, tags, created_at) VALUES (?, ?, ?, ?, NOW())",
    [userId, title, description, tags],
    (err, result) => {
      if (err) return res.status(500).json(err);
      const boardId = result.insertId;
      db.query(
        "INSERT INTO board_members (board_id, user_id, role) VALUES (?, ?, 'owner')",
        [boardId, userId],
      );
      const colVals = [
        [boardId, "To Do", 1],
        [boardId, "In Progress", 2],
        [boardId, "Under Review", 3],
        [boardId, "Done", 4],
      ];
      db.query(
        "INSERT INTO columns (board_id, title, position) VALUES ?",
        [colVals],
        () => {
          if (links && links.length > 0) {
            const linkVals = links.map((l) => [boardId, l.title, l.url]);
            db.query(
              "INSERT INTO board_links (board_id, link_name, link_url) VALUES ?",
              [linkVals],
            );
          }
          res.json({ msg: "Board Created", boardId });
        },
      );
    },
  );
});

// Edit Board now handles links properly
app.put("/update-board", (req, res) => {
  const { boardId, title, description, tags, links } = req.body;
  db.query(
    "UPDATE boards SET boardtitle = ?, description = ?, tags = ? WHERE id = ?",
    [title, description, tags, boardId],
    (err) => {
      if (err) return res.status(500).json(err);
      db.query("DELETE FROM board_links WHERE board_id = ?", [boardId], () => {
        if (links && links.length > 0) {
          const linkVals = links.map((l) => [boardId, l.title, l.url]);
          db.query(
            "INSERT INTO board_links (board_id, link_name, link_url) VALUES ?",
            [linkVals],
          );
        }
        res.json({ msg: "Board Updated" });
      });
    },
  );
});

//  BOARD DETAILS
app.get("/board-details/:boardId", (req, res) => {
  const boardId = req.params.boardId;
  db.query("SELECT * FROM boards WHERE id = ?", [boardId], (err, boardRes) => {
    if (boardRes.length === 0)
      return res.status(404).json({ error: "Not found" });
    const board = boardRes[0];
    db.query(
      "SELECT * FROM board_links WHERE board_id = ?",
      [boardId],
      (err, links) => {
        db.query(
          "SELECT u.id, u.username, u.email FROM board_members bm JOIN users u ON bm.user_id = u.id WHERE bm.board_id = ?",
          [boardId],
          (err, members) => {
            db.query(
              "SELECT * FROM columns WHERE board_id = ? ORDER BY position",
              [boardId],
              (err, cols) => {
                const colIds = cols.map((c) => c.id);
                if (colIds.length === 0)
                  return res.json({
                    board,
                    links,
                    members,
                    columns: [],
                    tasks: [],
                  });
                // Include start_date and due_date
                const sqlTasks = `SELECT t.*, u.username as assignee_name FROM tasks t LEFT JOIN users u ON t.assignee_id = u.id WHERE t.column_id IN (?) ORDER BY position`;
                db.query(sqlTasks, [colIds], (err, tasks) => {
                  res.json({
                    board,
                    links,
                    members,
                    columns: cols,
                    tasks: tasks || [],
                  });
                });
              },
            );
          },
        );
      },
    );
  });
});

app.post("/invite-user", (req, res) => {
  const { boardId, email } = req.body;
  db.query("SELECT id FROM users WHERE email = ?", [email], (err, results) => {
    if (results.length === 0)
      return res.status(404).json({ msg: "User not found" });
    const userId = results[0].id;
    db.query(
      "SELECT * FROM board_members WHERE board_id = ? AND user_id = ?",
      [boardId, userId],
      (err, existing) => {
        if (existing.length > 0)
          return res.status(400).json({ msg: "User is already a member" });
        db.query(
          "INSERT INTO board_members (board_id, user_id, role) VALUES (?, ?, 'member')",
          [boardId, userId],
          (err) => {
            if (err) return res.status(500).json(err);
            res.json({ msg: "User Added" });
          },
        );
      },
    );
  });
});

//  TASKS

// Add Start Date and Due Date
app.post("/create-task", (req, res) => {
  const {
    columnId,
    title,
    description,
    priority,
    assigneeEmail,
    boardId,
    startDate,
    dueDate,
    dependsOn,
  } = req.body;

  const insertTask = (assigneeId) => {
    const sql =
      "INSERT INTO tasks (column_id, title, description, priority, assignee_id, start_date, due_date, position, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, 0, NOW())";
    db.query(
      sql,
      [
        columnId,
        title,
        description,
        priority,
        assigneeId,
        startDate || null,
        dueDate || null,
      ],
      (err, result) => {
        if (err) return res.status(500).json(err);

        const newTaskId = result.insertId;

        // Handle Dependency if provided
        if (dependsOn && dependsOn.trim() !== "") {
          const findDepSql = `
            SELECT id FROM tasks 
            WHERE title = ? AND column_id IN (SELECT id FROM columns WHERE board_id = ?) 
            LIMIT 1`;

          db.query(findDepSql, [dependsOn, boardId], (err, depResult) => {
            if (depResult.length > 0) {
              const parentId = depResult[0].id;
              db.query(
                "INSERT INTO task_dependencies (task_id, depends_on_task_id) VALUES (?, ?)",
                [newTaskId, parentId],
              );
            }
            // if dependency isn't found, just skip.
            res.json({ msg: "Task Added", taskId: newTaskId });
          });
        } else {
          res.json({ msg: "Task Added", taskId: newTaskId });
        }
      },
    );
  };

  if (assigneeEmail) {
    db.query(
      `SELECT u.id FROM users u JOIN board_members bm ON u.id = bm.user_id WHERE u.email = ? AND bm.board_id = ?`,
      [assigneeEmail, boardId],
      (err, results) => {
        if (results.length === 0)
          return res.status(400).json({ msg: "Invalid user." });
        insertTask(results[0].id);
      },
    );
  } else {
    insertTask(null);
  }
});

//  Required PUT route for Updates
app.put("/tasks/:id", (req, res) => {
  const { title, description, priority, startDate, dueDate } = req.body;
  const sql =
    "UPDATE tasks SET title = ?, description = ?, priority = ?, start_date = ?, due_date = ? WHERE id = ?";
  db.query(
    sql,
    [title, description, priority, startDate, dueDate, req.params.id],
    (err) => {
      if (err) return res.status(500).json(err);
      res.json({ msg: "Task Updated" });
    },
  );
});

// FIX: Permanent Task Deletion [cite: 6, 7]
app.delete("/tasks/:id", (req, res) => {
  db.query("DELETE FROM tasks WHERE id = ?", [req.params.id], (err) => {
    if (err) return res.status(500).json(err);
    res.json({ msg: "Task deleted" });
  });
});

// FIX: Dependency Logic for Move [cite: 40, 42]
function checkDependencies(taskId, cb) {
  // Check if task has incomplete dependencies
  const sql = `
        SELECT count(*) as count 
        FROM task_dependencies td
        JOIN tasks t ON td.depends_on_task_id = t.id
        JOIN columns c ON t.column_id = c.id
        WHERE td.task_id = ? AND c.title != 'Done'
    `;
  db.query(sql, [taskId], (err, results) => {
    if (err) return cb(err);
    return cb(null, results[0].count > 0);
  });
}

app.put("/advance-task", (req, res) => {
  const { taskId, currentColumnTitle, boardId } = req.body;
  const flow = ["To Do", "In Progress", "Under Review", "Done"];
  const currentIndex = flow.indexOf(currentColumnTitle);
  const nextTitle = flow[currentIndex + 1];

  if (!nextTitle) return res.json({ msg: "Done" });

  // If moving to Done, check dependencies
  if (nextTitle === "Done") {
    checkDependencies(taskId, (err, blocked) => {
      if (blocked)
        return res.status(403).json({
          error: "Cannot complete task: Dependent tasks are incomplete.",
        });

      proceedMove();
    });
  } else {
    proceedMove();
  }

  function proceedMove() {
    db.query(
      "SELECT id FROM columns WHERE board_id = ? AND title = ?",
      [boardId, nextTitle],
      (err, results) => {
        if (results.length === 0)
          return res.status(500).json({ error: "Column missing" });
        db.query(
          "UPDATE tasks SET column_id = ? WHERE id = ?",
          [results[0].id, taskId],
          () => {
            res.json({ msg: "Moved to " + nextTitle });
          },
        );
      },
    );
  }
});

app.put("/move-task", (req, res) => {
  const { taskId, targetColumnId } = req.body;

  // Check if target is 'Done' column
  db.query(
    "SELECT title FROM columns WHERE id = ?",
    [targetColumnId],
    (err, resCol) => {
      if (resCol.length > 0 && resCol[0].title === "Done") {
        checkDependencies(taskId, (err, blocked) => {
          if (blocked)
            return res.status(403).json({
              error: "Cannot complete task: Dependent tasks are incomplete.",
            });
          updateCol();
        });
      } else {
        updateCol();
      }
    },
  );

  function updateCol() {
    db.query(
      "UPDATE tasks SET column_id = ? WHERE id = ?",
      [targetColumnId, taskId],
      (err) => res.json({ msg: "Moved" }),
    );
  }
});

app.listen(3000, () => console.log("Server running on port 3000"));
