const express = require('express');
const http = require('http');
const path = require('path');
const socketIo = require('socket.io');
const admin = require('firebase-admin');

// IMPORTANT: Check if serviceAccountKey.json exists
let serviceAccount;
try {
    serviceAccount = require('./serviceAccountKey.json');
} catch (error) {
    console.error("FATAL ERROR: serviceAccountKey.json not found!");
    console.error("Please ensure the service account key file is present in the root directory.");
    process.exit(1); // Exit the process if the key is not found
}

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});
const db = admin.firestore();
const auth = admin.auth();

const app = express();
const server = http.createServer(app);

const io = socketIo(server, {
  cors: {
    origin: "*", // Allows all origins
    methods: ["GET", "POST"]
  }
});

app.use(express.static('public'));

// --- THIS IS THE FIX ---
// Explicitly serve index.html for the root route
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.get('/admin', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'admin.html'));
});

// New route to get TURN server credentials
app.get('/ice-servers', async (req, res) => {
    // This part requires Twilio credentials to be set as environment variables
    const accountSid = process.env.TWILIO_ACCOUNT_SID;
    const authToken = process.env.TWILIO_AUTH_TOKEN;
    
    if (!accountSid || !authToken) {
        // If credentials are not set, return only STUN servers
        console.warn("Twilio credentials not set. Returning STUN servers only.");
        return res.send([{ urls: 'stun:stun.l.google.com:19302' }]);
    }

    const twilio = require('twilio')(accountSid, authToken);
    try {
        const token = await twilio.tokens.create();
        res.send(token.iceServers);
    } catch (error) {
        console.error("Error fetching Twilio ICE servers:", error);
        res.status(500).send("Error fetching ICE servers");
    }
});

// All your existing socket.io logic...
let waitingPool = []; 
const userPartners = {}; 
const socketToUser = {}; 
const REPORT_THRESHOLD = 10;
const SUSPENSION_HOURS = 24;
io.on('connection', (socket) => {
    console.log(`New user/admin connected: ${socket.id}`);
    socket.on('adminGetDashboardData', async () => { try { const usersSnapshot = await db.collection('users').get(); const reportsSnapshot = await db.collection('reports').get(); const suspendedSnapshot = await db.collection('users').where('status', '==', 'suspended').get(); socket.emit('adminReceiveDashboardData', { totalUsers: usersSnapshot.size, totalReports: reportsSnapshot.size, suspendedUsers: suspendedSnapshot.size }); } catch (error) { console.error("Server error getting dashboard data:", error); } });
    socket.on('adminGetUsers', async () => { try { const usersSnapshot = await db.collection('users').get(); const usersArray = []; usersSnapshot.forEach(doc => usersArray.push(doc.data())); socket.emit('adminReceiveUsers', usersArray); } catch (error) { console.error("Server error getting users:", error); } });
    socket.on('adminGetReports', async () => { try { const reportsSnapshot = await db.collection('reports').get(); const reportsArray = []; reportsSnapshot.forEach(doc => reportsArray.push(doc.data())); socket.emit('adminReceiveReports', reportsArray); } catch (error) { console.error("Server error getting reports:", error); } });
    socket.on('adminSuspendUser', async (data) => { try { await auth.updateUser(data.uid, { disabled: true }); await db.collection('users').doc(data.uid).update({ status: 'suspended' }); console.log(`Admin suspended user: ${data.uid}`); io.emit('userStatusChanged'); } catch (error) { console.error(`Failed to suspend user ${data.uid}:`, error); } });
    socket.on('adminUnsuspendUser', async (data) => { try { await auth.updateUser(data.uid, { disabled: false }); await db.collection('users').doc(data.uid).update({ status: 'active' }); console.log(`Admin unsuspended user: ${data.uid}`); io.emit('userStatusChanged'); } catch (error) { console.error(`Failed to unsuspend user ${data.uid}:`, error); } });
    socket.on('userReady', (data) => { socketToUser[socket.id] = { uid: data.uid, email: data.email }; findPartnerFor(socket); });
    socket.on('reportPartner', async (data) => { const reporterSocketId = socket.id; const reportedSocketId = userPartners[reporterSocketId]; if (reportedSocketId && socketToUser[reporterSocketId] && socketToUser[reportedSocketId]) { const reporter = socketToUser[reporterSocketId]; const reported = socketToUser[reportedSocketId]; const reportedUserRef = db.collection('users').doc(reported.uid); try { await db.collection('reports').add({ reporterId: reporter.uid, reporterEmail: reporter.email, reportedId: reported.uid, reportedEmail: reported.email, reason: data.reason, timestamp: admin.firestore.FieldValue.serverTimestamp(), status: 'open' }); const newReportCount = await db.runTransaction(async (transaction) => { const userDoc = await transaction.get(reportedUserRef); if (!userDoc.exists) return null; const currentCount = userDoc.data().reportCount || 0; const newCount = currentCount + 1; transaction.update(reportedUserRef, { reportCount: newCount }); return newCount; }); console.log(`Report filed by ${reporter.email} against ${reported.email}. New count: ${newReportCount}`); if (newReportCount >= REPORT_THRESHOLD) { const suspensionEndTime = new Date(); suspensionEndTime.setHours(suspensionEndTime.getHours() + SUSPENSION_HOURS); await reportedUserRef.update({ status: 'suspended', suspendedUntil: admin.firestore.Timestamp.fromDate(suspensionEndTime) }); await auth.updateUser(reported.uid, { disabled: true }); console.log(`User ${reported.email} has been suspended until ${suspensionEndTime}.`); io.to(reportedSocketId).emit('accountSuspended'); } socket.emit('reportSuccess'); } catch (error) { console.error("Error processing report:", error); socket.emit('reportFail'); } } });
    socket.on('findNewPartner', () => { cleanUpSocket(socket); findPartnerFor(socket); });
    socket.on('disconnect', () => { console.log(`User disconnected: ${socket.id}`); cleanUpSocket(socket); });
    socket.on('sendMessage', (data) => { io.to(data.partnerId).emit('receiveMessage', { message: data.message }); });
    socket.on('typing', () => { const partnerId = userPartners[socket.id]; if (partnerId) io.to(partnerId).emit('partnerTyping'); });
    socket.on('stoppedTyping', () => { const partnerId = userPartners[socket.id]; if (partnerId) io.to(partnerId).emit('partnerStoppedTyping'); });
    socket.on('signal', (data) => { io.to(data.partnerId).emit('signal', { signal: data.signal, senderId: socket.id }); });
});
function cleanUpSocket(socket) { const partnerId = userPartners[socket.id]; if (partnerId) { io.to(partnerId).emit('partnerDisconnected'); delete userPartners[partnerId]; } delete userPartners[socket.id]; delete socketToUser[socket.id]; waitingPool = waitingPool.filter(s => s.id !== socket.id); }
function findPartnerFor(socket) { if (waitingPool.length > 0) { const partnerSocket = waitingPool.shift(); userPartners[socket.id] = partnerSocket.id; userPartners[partnerSocket.id] = socket.id; partnerSocket.emit('partner', { id: socket.id, isInitiator: false }); socket.emit('partner', { id: partnerSocket.id, isInitiator: true }); console.log(`Paired ${socket.id} with ${partnerSocket.id}`); } else { waitingPool.push(socket); console.log(`${socket.id} is waiting for a partner.`); } }

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Server is running on port ${PORT}`));
