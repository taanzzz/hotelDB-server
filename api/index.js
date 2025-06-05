const express = require("express");
const cors = require("cors");
const jwt = require("jsonwebtoken");
const { MongoClient, ObjectId, ServerApiVersion } = require("mongodb");
require("dotenv").config();

const app = express();

// Middleware
app.use(cors());
app.use(express.json());

// MongoDB Connection
const client = new MongoClient(process.env.MONGODB_URI, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
});

let roomsCollection;
let bookingsCollection;
let reviewsCollection;

async function run() {
  try {
    const db = client.db("HotelDB");
    roomsCollection = db.collection("rooms");
    bookingsCollection = db.collection("bookings");
    reviewsCollection = db.collection("reviews");

    console.log("✅ MongoDB Ready (Vercel)");
  } catch (err) {
    console.error("❌ MongoDB error:", err);
  }
}
run();

// JWT Token Endpoint
app.post("/jwt", (req, res) => {
  const user = req.body;
  const token = jwt.sign(user, process.env.JWT_SECRET, { expiresIn: "1d" });
  res.send({ token });
});

// JWT Middleware
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

// Routes
// -------------------- Rooms --------------------

// Get all rooms
app.get("/rooms", async (req, res) => {
  try {
    const result = await roomsCollection.find().toArray();
    res.send(result);
  } catch (error) {
    res.status(500).send({ error: "Failed to fetch rooms" });
  }
});

// Get single room by ID
app.get("/rooms/:id", async (req, res) => {
  try {
    const id = req.params.id;
    const result = await roomsCollection.findOne({ _id: new ObjectId(id) });
    res.send(result);
  } catch (error) {
    res.status(500).send({ error: "Failed to fetch room" });
  }
});

// -------------------- Bookings --------------------

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

// Get bookings for a specific user
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

// Cancel a booking
app.delete("/bookings/:id", verifyToken, async (req, res) => {
  const id = req.params.id;
  try {
    const result = await bookingsCollection.deleteOne({ _id: new ObjectId(id) });
    res.send(result);
  } catch (error) {
    res.status(500).send({ error: "Failed to cancel booking" });
  }
});

// Update booking date
app.patch("/bookings/:id", verifyToken, async (req, res) => {
  const id = req.params.id;
  const { date } = req.body;
  try {
    const result = await bookingsCollection.updateOne(
      { _id: new ObjectId(id) },
      { $set: { date } }
    );
    res.send(result);
  } catch (error) {
    res.status(500).send({ error: "Failed to update booking date" });
  }
});

// -------------------- Reviews --------------------

// Submit a review
app.post("/reviews", verifyToken, async (req, res) => {
  const { roomId, userName, rating, comment } = req.body;
  try {
    const review = { roomId, userName, rating, comment, createdAt: new Date() };
    const result = await reviewsCollection.insertOne(review);
    res.send(result);
  } catch (error) {
    res.status(500).send({ error: "Failed to submit review" });
  }
});

// ✅ Get reviews for a specific room
app.get("/reviews/:roomId", async (req, res) => {
  const { roomId } = req.params;
  try {
    const result = await reviewsCollection
      .find({ roomId })
      .sort({ createdAt: -1 })
      .toArray();
    res.send(result);
  } catch (error) {
    res.status(500).send({ error: "Failed to fetch reviews" });
  }
});

// -------------------- Root --------------------
app.get("/", (req, res) => {
  res.send("🏨 Hotel Booking Server is Running");
});

// Local server for development
if (process.env.NODE_ENV !== "production") {
  const port = process.env.PORT || 3000;
  app.listen(port, () => {
    console.log(`🚀 Server running at http://localhost:${port}`);
  });
}

// Export for Vercel
module.exports = app;
