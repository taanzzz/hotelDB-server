const express = require("express");
const cors = require("cors");
const jwt =require("jsonwebtoken");
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
let usersCollection; // নতুন usersCollection যোগ করা হলো

async function run() {
  try {
    const db = client.db("HotelDB");
    roomsCollection = db.collection("rooms");
    bookingsCollection = db.collection("bookings");
    reviewsCollection = db.collection("reviews");
    usersCollection = db.collection("users"); // ইনিশিয়ালাইজ করা হলো

    console.log("✅ MongoDB Ready");
  } catch (err) {
    console.error("❌ MongoDB error:", err);
  }
}
run();

// --- নতুন: verifyAdmin মিডলওয়্যার ---
const verifyAdmin = async (req, res, next) => {
  const email = req.decoded.email;
  const query = { email: email };
  const user = await usersCollection.findOne(query);
  if (user?.role !== 'admin') {
    return res.status(403).send({ message: 'Forbidden Access' });
  }
  next();
}


// --- পরিবর্তিত JWT Token Endpoint ---
app.post("/jwt", async (req, res) => {
  const userInfo = req.body;
  const email = userInfo.email;

  // ব্যবহারকারী ডাটাবেসে আছে কিনা চেক করুন
  const existingUser = await usersCollection.findOne({ email: email });

  if (!existingUser) {
    // যদি না থাকে, নতুন ব্যবহারকারী হিসেবে 'user' রোলে সেভ করুন
    const newUser = {
      email: email,
      name: userInfo.name || 'N/A', // গুগল সাইন ইন থেকে নাম আসতে পারে
      photoURL: userInfo.photoURL || 'N/A',
      role: 'user' // ডিফল্ট রোল
    };
    await usersCollection.insertOne(newUser);
  }
  
  // ব্যবহারকারীর তথ্যসহ নতুন টোকেন তৈরি করুন
  const userForToken = await usersCollection.findOne({ email: email });
  const token = jwt.sign({ email: userForToken.email, role: userForToken.role }, process.env.JWT_SECRET, { expiresIn: "1d" });
  
  res.send({ token });
});


// JWT Middleware (Unchanged)
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

// -------------------- Users Part (নতুন) --------------------
// Get user data by email
app.get('/users/:email', verifyToken, async (req, res) => {
    const email = req.params.email;
    if (req.decoded.email !== email) {
        return res.status(403).send({ message: "Forbidden Access" });
    }
    const result = await usersCollection.findOne({ email });
    res.send(result);
});

// Get all users (Admin Only)
app.get('/users', verifyToken, verifyAdmin, async (req, res) => {
    const result = await usersCollection.find().toArray();
    res.send(result);
});

// Make a user admin (Admin Only)
app.patch('/users/admin/:id', verifyToken, verifyAdmin, async(req, res) => {
    const id = req.params.id;
    const filter = { _id: new ObjectId(id) };
    const updatedDoc = {
        $set: {
            role: 'admin'
        }
    };
    const result = await usersCollection.updateOne(filter, updatedDoc);
    res.send(result);
});

// -------------------- Admin Stats Part (পরিবর্তিত) --------------------
// Get all stats (Admin Only)
app.get('/admin/stats', verifyToken, verifyAdmin, async (req, res) => {
    try {
        const usersCount = await usersCollection.estimatedDocumentCount();
        const roomsCount = await roomsCollection.estimatedDocumentCount();
        const bookingsCount = await bookingsCollection.estimatedDocumentCount();

        const revenueResult = await bookingsCollection.aggregate([
            {
                $lookup: {
                    from: 'rooms',
                    let: { booking_roomId_str: "$roomId" },
                    pipeline: [
                        { $addFields: { "string_id": { "$toString": "$_id" } } },
                        { $match: { $expr: { "$eq": ["$string_id", "$$booking_roomId_str"] } } }
                    ],
                    as: 'roomDetails'
                }
            },
            { $unwind: '$roomDetails' },
            {
                $group: {
                    _id: null,
                    totalRevenue: { $sum: '$roomDetails.price' }
                }
            }
        ]).toArray();
        const totalRevenue = revenueResult.length > 0 ? revenueResult[0].totalRevenue : 0;
        
        // --- সাম্প্রতিক বুকিং এর তালিকা (ব্যবহারকারীর ছবিসহ) ---
        const recentBookings = await bookingsCollection.aggregate([
            { $sort: { createdAt: -1 } }, // আপনার বুকিং স্কিমাতে বুকিং তৈরির তারিখ অনুযায়ী সর্ট করুন
            { $limit: 5 },
            {
                $lookup: {
                    from: 'users', // users কালেকশনের সাথে জয়েন করুন
                    localField: 'email', // bookings কালেকশনের 'email' ফিল্ড
                    foreignField: 'email', // users কালেকশনের 'email' ফিল্ড
                    as: 'userDetails' // নতুন অ্যারের নাম
                }
            },
            { $unwind: '$userDetails' }, // অ্যারে থেকে অবজেক্টে রূপান্তর
            {
                $project: { // প্রয়োজনীয় ফিল্ডগুলো নির্বাচন করুন
                    _id: 1,
                    email: 1,
                    date: 1,
                    userPhoto: '$userDetails.photoURL' // ব্যবহারকারীর ছবি যোগ করুন
                }
            }
        ]).toArray();

        res.send({
            users: usersCount,
            rooms: roomsCount,
            bookings: bookingsCount,
            revenue: totalRevenue,
            recentBookings // ছবিসহ নতুন ডেটা পাঠান
        });

    } catch (error) {
        console.error("Error fetching admin stats:", error);
        res.status(500).send({ message: 'Failed to fetch admin statistics' });
    }
});

// -------------------- Rooms Part (Unchanged) --------------------
// ... আপনার বাকি কোড এখানে অপরিবর্তিত থাকবে ...
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



// -------------------- Bookings Part --------------------More actions

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

// Get a single booking by its ID
app.get("/booking/:id", verifyToken, async (req, res) => {
  try {
    const { id } = req.params;
    // Check if the ID is a valid MongoDB ObjectId
    if (!ObjectId.isValid(id)) {
      return res.status(400).send({ message: "Invalid booking ID format" });
    }

    const booking = await bookingsCollection.findOne({ _id: new ObjectId(id) });

    if (!booking) {
      return res.status(404).send({ message: "Booking not found" });
    }

    // Authorization check: ensure the user requesting the booking is the one who made it
    if (req.decoded.email !== booking.email) {
      return res.status(403).send({ message: "Forbidden Access" });
    }

    res.send(booking);
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
app.delete("/bookings/:id", verifyToken, async (req, res) => {
  const bookingId = req.params.id;
  const userEmail = req.decoded.email; 

  try {
    
    const booking = await bookingsCollection.findOne({ _id: new ObjectId(bookingId) });

    if (!booking) {
      return res.status(404).send({ message: "Booking not found" });
    }

    
    if (booking.email !== userEmail) {
      return res.status(403).send({ message: "Forbidden: You are not authorized to cancel this booking." });
    }

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
