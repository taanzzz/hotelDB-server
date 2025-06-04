const express = require("express");
const cors = require("cors");
const jwt = require("jsonwebtoken");
const { MongoClient, ObjectId, ServerApiVersion } = require("mongodb");
require("dotenv").config();

const app = express();

// middleware
app.use(cors());
app.use(express.json());

// MongoDB connection
const client = new MongoClient(process.env.MONGODB_URI, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
});

let roomsCollection;
let bookingsCollection;

// Run MongoDB only once
async function run() {
  try {
    await client.connect();
    console.log("✅ MongoDB Connected");

    const db = client.db("HotelDB");
    roomsCollection = db.collection("rooms");
    bookingsCollection = db.collection("bookings");
  } catch (err) {
    console.error("❌ MongoDB connection failed:", err);
  }
}
run();

// JWT Token API
app.post("/jwt", (req, res) => {
  const user = req.body;
  const token = jwt.sign(user, process.env.JWT_SECRET, {
    expiresIn: "1d",
  });
  res.send({ token });
});

// Middleware to verify token
function verifyToken(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader) {
    return res.status(401).send({ message: "Unauthorized" });
  }

  const token = authHeader.split(" ")[1];
  jwt.verify(token, process.env.JWT_SECRET, (err, decoded) => {
    if (err) {
      return res.status(403).send({ message: "Forbidden" });
    }
    req.decoded = decoded;
    next();
  });
}

// Get all rooms
app.get("/rooms", async (req, res) => {
  try {
    const result = await roomsCollection.find().toArray();
    res.send(result);
  } catch (error) {
    console.error("❌ Error in /rooms:", error.message);
    res.status(500).send({ error: "Failed to fetch rooms" });
  }
});

// Get single room
app.get("/rooms/:id", async (req, res) => {
  try {
    const id = req.params.id;
    const result = await roomsCollection.findOne({ _id: new ObjectId(id) });
    res.send(result);
  } catch (error) {
    res.status(500).send({ error: "Failed to fetch room" });
  }
});

// Book a room
app.post("/bookings", verifyToken, async (req, res) => {
  try {
    const booking = req.body;
    const result = await bookingsCollection.insertOne(booking);
    res.send(result);
  } catch (error) {
    res.status(500).send({ error: "Failed to book room" });
  }
});

// Get user's bookings
app.get("/bookings", verifyToken, async (req, res) => {
  const email = req.query.email;
  if (req.decoded.email !== email) {
    return res.status(403).send({ message: "Forbidden Access" });
  }
  try {
    const result = await bookingsCollection.find({ email }).toArray();
    res.send(result);
  } catch (error) {
    res.status(500).send({ error: "Failed to fetch bookings" });
  }
});

// Root route
app.get("/", (req, res) => {
  res.send("Hotel Booking Server is Running 🏨");
});

// ✅ Handle local dev vs Vercel
if (process.env.NODE_ENV !== "production") {
  const port = process.env.PORT || 3000;
  app.listen(port, () => {
    console.log(`🚀 Server running locally on http://localhost:${port}`);
  });
}

// ✅ Export for Vercel
module.exports = app;
