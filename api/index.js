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

    console.log("✅ MongoDB Ready");
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

// -------------------- Rooms Part --------------------

// Get all rooms (with price range filter)
app.get('/rooms', async (req, res) => {
  try {
    const { minPrice, maxPrice } = req.query;

    let query = {};

    if (minPrice && maxPrice) {
      query.price = {
        $gte: parseFloat(minPrice),
        $lte: parseFloat(maxPrice)
      };
    }

    const rooms = await roomsCollection.find(query).toArray();
    res.send(rooms);
  } catch (err) {
    console.error(err);
    res.status(500).send({ error: 'Internal server error' });
  }
});

// Get Top 6 Rooms by Rating
app.get("/rooms/featured/top-rated", async (req, res) => {
  try {
    const topRooms = await roomsCollection
      .find()
      .sort({ rating: -1 })
      .limit(6)
      .toArray();
    res.send(topRooms);
  } catch (error) {
    res.status(500).send({ error: "Failed to fetch top-rated rooms" });
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



// -------------------- Bookings Part --------------------

// Book a room (with duplicate check)
app.post("/bookings", verifyToken, async (req, res) => {
  try {
    const booking = req.body;
    const { roomId, email, date } = booking;

    // Verify whether the user has already booked this room for the selected date.
    const existingUserBooking = await bookingsCollection.findOne({
      roomId,
      email,
      date,
    });

    if (existingUserBooking) {
      return res.status(400).send({ message: "You already booked this room on this date" });
    }

    // Check whether the room has already been booked by another user for the selected date.
    const existingRoomBooking = await bookingsCollection.findOne({
      roomId,
      date,
    });

    if (existingRoomBooking) {
      return res.status(409).send({ message: "Room already booked on this date" });
    }

    // Insert booking if all good
    const result = await bookingsCollection.insertOne(booking);
    res.send(result);
  } catch (error) {
    res.status(500).send({ error: "Failed to book room" });
  }
});

// Get bookings for a specific user by email
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

// GET A SINGLE BOOKING BY ID (এই নতুন রুটটি যোগ করুন)
app.get("/bookings/:id", verifyToken, async (req, res) => {
  try {
    const id = req.params.id;
    const booking = await bookingsCollection.findOne({ _id: new ObjectId(id) });

    if (!booking) {
      return res.status(404).send({ message: "Booking not found" });
    }

    // নিরাপত্তা যাচাই: যিনি বুকিং করেছেন, শুধু তিনিই যেন এটি দেখতে পান
    if (req.decoded.email !== booking.email) {
      return res.status(403).send({ message: "Forbidden Access" });
    }
    
    res.send(booking);
  } catch (error) {
    console.error("Error fetching booking by ID:", error);
    res.status(500).send({ error: "Failed to fetch booking" });
  }
});

// Retrieve all booked dates for a specific room.
app.get("/bookings/room/:roomId/dates", async (req, res) => {
  try {
    const { roomId } = req.params;
    const bookings = await bookingsCollection
      .find({ roomId }, { projection: { date: 1, _id: 0 } })
      .toArray();
    const dates = bookings.map(b => b.date);
    res.send(dates);
  } catch (error) {
    res.status(500).send({ error: "Failed to fetch booked dates" });
  }
});

// Check if a user has already booked this room.
app.get("/bookings/check", verifyToken, async (req, res) => {
  const { roomId, email } = req.query;

  if (req.decoded.email !== email) {
    return res.status(403).send({ message: "Forbidden Access" });
  }

  try {
    const existingBooking = await bookingsCollection.findOne({ roomId, email });
    res.send({ hasBooked: !!existingBooking });
  } catch (error) {
    res.status(500).send({ error: "Failed to check booking status" });
  }
});

// Get bookings for a specific room on a specific date
app.get("/bookings/room/:roomId/date/:date", async (req, res) => {
  try {
    const { roomId, date } = req.params;
    const result = await bookingsCollection.find({ roomId, date }).toArray();
    res.send(result);
  } catch (error) {
    res.status(500).send({ error: "Failed to fetch room bookings for date" });
  }
});

// Get bookings for a specific user by email
app.get("/bookings/user/:email", verifyToken, async (req, res) => {
  const { email } = req.params;
  if (req.decoded.email !== email) {
    return res.status(403).send({ message: "Forbidden Access" });
  }

  try {
    const result = await bookingsCollection.find({ email }).toArray();
    res.send(result);
  } catch (error) {
    res.status(500).send({ error: "Failed to fetch user bookings" });
  }
});

// Cancel a booking
app.delete("/bookings/:id", async (req, res) => {
  const bookingId = req.params.id;

  try {
    const result = await bookingsCollection.deleteOne({ _id: new ObjectId(bookingId) });
    if (result.deletedCount === 1) {
      res.send({ message: "Booking cancelled successfully" });
    } else {
      res.status(404).send({ message: "Booking not found" });
    }
  } catch (error) {
    console.error("Error cancelling booking:", error);
    res.status(500).send({ message: "Server error" });
  }
});

// Update booking date
app.patch("/bookings/:id", verifyToken, async (req, res) => {
  const id = req.params.id;
  const { date } = req.body;

  try {
    // Before updating, check if the room is already booked by anyone else on that new date
    const existingBooking = await bookingsCollection.findOne({
      roomId: req.body.roomId,
      date,
      _id: { $ne: new ObjectId(id) },
    });

    if (existingBooking) {
      return res.status(409).send({ message: "Room already booked on this date" });
    }

    const result = await bookingsCollection.updateOne(
      { _id: new ObjectId(id) },
      { $set: { date } }
    );

    res.send(result);
  } catch (error) {
    res.status(500).send({ error: "Failed to update booking date" });
  }
});



// -------------------- Reviews Part --------------------

// Submit a review
app.post("/reviews", verifyToken, async (req, res) => {
  const { roomId, username, userEmail, userPhoto, rating, comment } = req.body;
  try {
    const review = {
      roomId,
      username,         
      userEmail,
      userPhoto,
      rating,
      comment,
      createdAt: new Date(),  
    };
    const result = await reviewsCollection.insertOne(review);
    res.send(result);
  } catch (error) {
    res.status(500).send({ error: "Failed to submit review" });
  }
});

// Get all reviews
app.get("/reviews", async (req, res) => {
  try {
    const result = await reviewsCollection.find().toArray();
    res.send(result);
  } catch (error) {
    res.status(500).send({ error: "Failed to fetch all reviews" });
  }
});

// Get reviews for a specific room
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