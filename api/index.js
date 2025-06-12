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

// Book a date range for a room
app.post("/bookings/range", verifyToken, async (req, res) => {
    try {
        const { roomId, email, dates, totalPrice, roomName, image, price } = req.body;
        
        // Check for existing bookings on the given dates for this room
        const existingBooking = await bookingsCollection.findOne({
            roomId: roomId,
            date: { $in: dates }
        });

        if (existingBooking) {
            return res.status(409).send({
                message: `One or more dates in your selected range are already booked. The first unavailable date is ${existingBooking.date}.`
            });
        }

        const bookingGroupId = new ObjectId(); // Create a unique ID for this booking group

        const bookingDocuments = dates.map(date => ({
            bookingGroupId, // Add the group ID to each document
            roomId,
            email,
            date,
            totalPrice,
            roomName,
            image,
            price
        }));
        
        const result = await bookingsCollection.insertMany(bookingDocuments);
        
        // Return the bookingGroupId to the client
        res.status(201).send({ ...result, bookingGroupId });

    } catch (error) {
        console.error("Error booking date range:", error);
        res.status(500).send({ error: "Failed to book the date range." });
    }
});


// Get bookings for a specific user by email, now grouped by bookingGroupId
app.get("/bookings", verifyToken, async (req, res) => {
    const email = req.query.email;
    if (req.decoded.email !== email) {
        return res.status(403).send({ message: "Forbidden Access" });
    }
    try {
        const bookings = await bookingsCollection.find({ email }).toArray();
        
        // Group bookings by bookingGroupId
        const groupedBookings = bookings.reduce((acc, booking) => {
            const groupId = booking.bookingGroupId.toString();
            if (!acc[groupId]) {
                acc[groupId] = {
                    bookingGroupId: groupId,
                    roomId: booking.roomId,
                    roomName: booking.roomName,
                    image: booking.image,
                    price: booking.price,
                    totalPrice: booking.totalPrice,
                    email: booking.email,
                    dates: [],
                };
            }
            acc[groupId].dates.push(booking.date);
            return acc;
        }, {});

        // Convert the grouped object to an array and sort dates
        const result = Object.values(groupedBookings).map(group => {
            group.dates.sort(); // Sort dates chronologically
            return group;
        });

        res.send(result);
    } catch (error) {
        res.status(500).send({ error: "Failed to fetch bookings" });
    }
});

// Get a single booking group by its bookingGroupId
app.get("/booking/group/:bookingGroupId", verifyToken, async (req, res) => {
    try {
        const { bookingGroupId } = req.params;
        if (!ObjectId.isValid(bookingGroupId)) {
            return res.status(400).send({ message: "Invalid booking group ID format" });
        }

        const bookings = await bookingsCollection.find({ bookingGroupId: new ObjectId(bookingGroupId) }).toArray();

        if (!bookings || bookings.length === 0) {
            return res.status(404).send({ message: "Booking not found" });
        }

        if (req.decoded.email !== bookings[0].email) {
            return res.status(403).send({ message: "Forbidden Access" });
        }
        
        // Consolidate booking details
        const bookingDetails = {
            bookingGroupId,
            roomId: bookings[0].roomId,
            roomName: bookings[0].roomName,
            price: bookings[0].price,
            totalPrice: bookings[0].totalPrice,
            image: bookings[0].image,
            dates: bookings.map(b => b.date).sort(),
        };

        res.send(bookingDetails);
    } catch (error) {
        console.error("Error fetching single booking:", error);
        res.status(500).send({ error: "Failed to fetch booking details" });
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

// Cancel a booking by bookingGroupId
app.delete("/bookings/group/:bookingGroupId", verifyToken, async (req, res) => {
    const { bookingGroupId } = req.params;

    if (!ObjectId.isValid(bookingGroupId)) {
        return res.status(400).send({ message: "Invalid booking ID" });
    }

    try {
        // First, verify the user owns this booking
        const bookingSample = await bookingsCollection.findOne({ bookingGroupId: new ObjectId(bookingGroupId) });
        if (!bookingSample) {
            return res.status(404).send({ message: "Booking not found" });
        }
        if (bookingSample.email !== req.decoded.email) {
            return res.status(403).send({ message: "Forbidden: You cannot cancel this booking." });
        }

        const result = await bookingsCollection.deleteMany({ bookingGroupId: new ObjectId(bookingGroupId) });

        if (result.deletedCount > 0) {
            res.send({ message: "Booking cancelled successfully" });
        } else {
            res.status(404).send({ message: "Booking not found" });
        }
    } catch (error) {
        console.error("Error cancelling booking:", error);
        res.status(500).send({ message: "Server error during cancellation" });
    }
});


// Update booking dates (this is more complex with ranges, for now, let's keep it simple)
app.patch("/bookings/group/:bookingGroupId", verifyToken, async (req, res) => {
    const { bookingGroupId } = req.params;
    const { newDates } = req.body; // Expect an array of new dates

    if (!ObjectId.isValid(bookingGroupId)) {
        return res.status(400).send({ message: "Invalid booking ID" });
    }

    try {
        const bookingSample = await bookingsCollection.findOne({ bookingGroupId: new ObjectId(bookingGroupId) });

        if (!bookingSample) {
            return res.status(404).send({ message: "Booking not found" });
        }
        if (bookingSample.email !== req.decoded.email) {
            return res.status(403).send({ message: "Forbidden" });
        }

        // Check if new dates are available
        const existingBooking = await bookingsCollection.findOne({
            roomId: bookingSample.roomId,
            date: { $in: newDates },
            bookingGroupId: { $ne: new ObjectId(bookingGroupId) }
        });

        if (existingBooking) {
            return res.status(409).send({ message: "One of the new dates is already booked." });
        }
        
        // This is a simplified update. A real-world scenario might need more logic
        // (e.g., deleting old entries and creating new ones).
        // For simplicity, we'll just show the concept.
        
        await bookingsCollection.deleteMany({ bookingGroupId: new ObjectId(bookingGroupId) });

        const newBookingDocs = newDates.map(date => ({
            ...bookingSample,
            _id: new ObjectId(), // new document ID
            date: date,
        }));
        
        await bookingsCollection.insertMany(newBookingDocs);


        res.send({ message: "Booking updated successfully." });

    } catch (error) {
        res.status(500).send({ error: "Failed to update booking dates." });
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