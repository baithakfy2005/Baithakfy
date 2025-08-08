// Firebase Config and Initialization...
const firebaseConfig = {
  apiKey: "AIzaSyBq-acfzbO643_l_T_wylNaNaU3VH-e0pY",
  authDomain: "baithakfy.firebaseapp.com",
  projectId: "baithakfy",
  storageBucket: "baithakfy.appspot.com",
  messagingSenderId: "715561561739",
  appId: "1:715561561739:web:59617781acf664401b2e8e"
};
firebase.initializeApp(firebaseConfig);
const auth = firebase.auth();
const db = firebase.firestore();

// --- THIS IS THE FIX ---
// Connect to the server. When deployed, this should be your Render URL.
// The code automatically detects if it's on localhost or a deployed server.
const socket = io(window.location.origin);

// --- DOM Elements ---
const authContainer = document.getElementById('auth-container');
const lobbyContainer = document.getElementById('lobby-container');
const mainChat = document.getElementById('main-chat');
const googleSigninButton = document.getElementById('google-signin-button');
const loginForm = document.getElementById('login-form');
const authError = document.getElementById('auth-error');
const welcomeMessage = document.getElementById('welcome-message');
const logoutButton = document.getElementById('logoutButton');
const startChatButton = document.getElementById('startChatButton');
const localVideo = document.getElementById('localVideo');
const remoteVideo = document.getElementById('remoteVideo');
const statusText = document.getElementById('statusText');
const nextButton = document.getElementById('nextButton');
const muteButton = document.getElementById('muteButton');
const videoButton = document.getElementById('videoButton');
const reportButton = document.getElementById('reportButton');
const chatLog = document.getElementById('chatLog');
const chatInput = document.getElementById('chatInput');
const sendMessageButton = document.getElementById('sendMessageButton');
const emojiButton = document.getElementById('emojiButton');
const typingIndicator = document.getElementById('typingIndicator');
const notificationSound = document.getElementById('notificationSound');
const reportModal = document.getElementById('report-modal');
const cancelReportButton = document.getElementById('cancel-report-button');
const submitReportButton = document.getElementById('submit-report-button');
const reportForm = document.getElementById('report-form');

// --- State & Setup ---
let localStream, peerConnection, partnerId, typingTimeout;
let iceServers = [{ urls: 'stun:stun.l.google.com:19302' }]; // Default STUN

// Fetch TURN server credentials from our server
fetch('/ice-servers')
    .then(res => res.json())
    .then(data => {
        iceServers = data;
        console.log("ICE server credentials fetched successfully.");
    })
    .catch(e => console.error("Could not fetch TURN credentials. Using STUN only.", e));


// --- Auth Logic (No changes here) ---
auth.onAuthStateChanged(user => { if (user) { checkUserStatus(user); } else { authContainer.classList.remove('hidden'); lobbyContainer.classList.add('hidden'); mainChat.classList.add('hidden'); } });
async function checkUserStatus(user) { const userRef = db.collection('users').doc(user.uid); try { const userDoc = await userRef.get(); if (userDoc.exists && userDoc.data().status === 'suspended') { const suspendedUntil = userDoc.data().suspendedUntil.toDate(); if (new Date() < suspendedUntil) { authError.textContent = `Your account is suspended until ${suspendedUntil.toLocaleString()}.`; auth.signOut(); return; } else { await userRef.update({ status: 'active' }); console.log("User suspension period is over. Firestore status updated."); } } authContainer.classList.add('hidden'); lobbyContainer.classList.remove('hidden'); mainChat.classList.add('hidden'); welcomeMessage.textContent = `Welcome, ${user.displayName || user.email}`; authError.textContent = ''; } catch (error) { console.error("Error checking user status:", error); authError.textContent = "Could not verify user status. Please try again."; } }
googleSigninButton.addEventListener('click', () => { const provider = new firebase.auth.GoogleAuthProvider(); auth.signInWithPopup(provider).then(async (result) => { const user = result.user; const userRef = db.collection('users').doc(user.uid); const userDoc = await userRef.get(); if (!userDoc.exists) { userRef.set({ name: user.displayName, email: user.email, createdAt: firebase.firestore.FieldValue.serverTimestamp(), uid: user.uid, reportCount: 0, status: 'active' }); } }).catch((error) => { authError.textContent = error.message; }); });
loginForm.addEventListener('submit', (e) => { e.preventDefault(); const email = loginForm['login-email'].value; const password = loginForm['login-password'].value; auth.signInWithEmailAndPassword(email, password).then(() => { loginForm.reset(); authError.textContent = ''; }).catch(error => { if (error.code === 'auth/user-disabled') { authError.textContent = 'This account has been suspended.'; } else { authError.textContent = error.message; } }); });
logoutButton.addEventListener('click', () => { if (peerConnection) { cleanupAndFindNext(false); } auth.signOut(); });


// --- Chat Logic ---
startChatButton.addEventListener('click', () => { lobbyContainer.classList.add('hidden'); mainChat.classList.remove('hidden'); startMedia(); });
function startMedia() { navigator.mediaDevices.getUserMedia({ video: true, audio: true }).then(stream => { localStream = stream; localVideo.srcObject = stream; statusText.textContent = 'Searching the Grid...'; muteButton.classList.remove('hidden'); videoButton.classList.remove('hidden'); const currentUser = auth.currentUser; socket.emit('userReady', { uid: currentUser.uid, email: currentUser.email }); }).catch(error => { statusText.textContent = 'Camera/Mic access denied.'; }); }
function cleanupAndFindNext(findNext = true) { if (peerConnection) { peerConnection.close(); peerConnection = null; } partnerId = null; remoteVideo.srcObject = null; chatInput.disabled = true; sendMessageButton.disabled = true; emojiButton.disabled = true; nextButton.classList.add('hidden'); reportButton.classList.add('hidden'); if (findNext) { addSystemMessage('Partner disconnected. Finding a new connection...'); socket.emit('findNewPartner'); } }
function addSystemMessage(message) { const messageDiv = document.createElement('div'); messageDiv.className = 'system-message'; messageDiv.textContent = message; chatLog.appendChild(messageDiv); chatLog.scrollTop = chatLog.scrollHeight; }
function addMessageToLog(message, type) { const messageDiv = document.createElement('div'); messageDiv.classList.add('message', type); messageDiv.textContent = message; chatLog.appendChild(messageDiv); chatLog.scrollTop = chatLog.scrollHeight; }
function sendMessage() { const message = chatInput.value.trim(); if (message && partnerId) { addMessageToLog(`You: ${message}`, 'sent'); socket.emit('sendMessage', { partnerId, message }); chatInput.value = ''; } }
nextButton.addEventListener('click', () => cleanupAndFindNext(true));
sendMessageButton.addEventListener('click', sendMessage);
chatInput.addEventListener('keypress', e => { if (e.key === 'Enter') sendMessage(); });
muteButton.addEventListener('click', () => { const audioTrack = localStream.getAudioTracks()[0]; audioTrack.enabled = !audioTrack.enabled; muteButton.textContent = audioTrack.enabled ? '🎤 Mute' : '🔇 Unmute'; muteButton.classList.toggle('toggled-off', !audioTrack.enabled); });
videoButton.addEventListener('click', () => { const videoTrack = localStream.getVideoTracks()[0]; videoTrack.enabled = !videoTrack.enabled; videoButton.textContent = videoTrack.enabled ? '📸 Video Off' : '📷 Video On'; localVideo.classList.toggle('hidden', !videoTrack.enabled); videoButton.classList.toggle('toggled-off', !videoTrack.enabled); });
chatInput.addEventListener('input', () => { clearTimeout(typingTimeout); socket.emit('typing'); typingTimeout = setTimeout(() => socket.emit('stoppedTyping'), 1500); });
emojiButton.addEventListener('click', () => { if (document.querySelector('emoji-picker')) { document.querySelector('emoji-picker').remove(); } else { const emojiPicker = document.createElement('emoji-picker'); document.body.appendChild(emojiPicker); emojiPicker.addEventListener('emoji-click', e => { chatInput.value += e.detail.emoji.unicode; emojiPicker.remove(); }); } });
reportButton.addEventListener('click', () => { reportModal.classList.remove('hidden'); });
cancelReportButton.addEventListener('click', () => { reportModal.classList.add('hidden'); });
submitReportButton.addEventListener('click', () => { const reason = reportForm.querySelector('input[name="report-reason"]:checked').value; socket.emit('reportPartner', { reason }); reportModal.classList.add('hidden'); });

// --- SOCKET.IO HANDLERS ---
socket.on('partner', data => {
    partnerId = data.id; statusText.textContent = 'Connection Found!'; 
    notificationSound.play().catch(e => console.log("Audio play failed"));
    chatLog.innerHTML = ''; addSystemMessage('You are now connected. Be respectful.');
    chatInput.disabled = false; sendMessageButton.disabled = false; emojiButton.disabled = false;
    nextButton.classList.remove('hidden'); reportButton.classList.remove('hidden');
    
    // Use the fetched iceServers (with TURN) to create the connection
    peerConnection = new RTCPeerConnection({ iceServers });

    localStream.getTracks().forEach(track => peerConnection.addTrack(track, localStream));
    peerConnection.ontrack = e => { remoteVideo.srcObject = e.streams[0]; };
    peerConnection.onicecandidate = e => { if (e.candidate) socket.emit('signal', { partnerId, signal: { ice: e.candidate } }); };
    if (data.isInitiator) { peerConnection.createOffer().then(offer => peerConnection.setLocalDescription(offer)).then(() => socket.emit('signal', { partnerId, signal: { sdp: peerConnection.localDescription } })); }
});
socket.on('signal', data => { const { signal, senderId } = data; if (peerConnection && signal.sdp) { peerConnection.setRemoteDescription(new RTCSessionDescription(signal.sdp)).then(() => { if (signal.sdp.type === 'offer') { peerConnection.createAnswer().then(answer => peerConnection.setLocalDescription(answer)).then(() => socket.emit('signal', { partnerId: senderId, signal: { sdp: peerConnection.localDescription } })); } }); } else if (peerConnection && signal.ice) { peerConnection.addIceCandidate(new RTCIceCandidate(signal.ice)); } });
socket.on('receiveMessage', data => addMessageToLog(`Stranger: ${data.message}`, 'received'));
socket.on('partnerTyping', () => { typingIndicator.textContent = 'Stranger is transmitting...'; });
socket.on('partnerStoppedTyping', () => { typingIndicator.textContent = ''; });
socket.on('partnerDisconnected', () => cleanupAndFindNext(true));
socket.on('reportSuccess', () => { addSystemMessage('Your report has been submitted. Thank you.'); cleanupAndFindNext(true); });
socket.on('reportFail', () => { addSystemMessage('Could not submit report. Please try again.'); });
socket.on('accountSuspended', () => { alert("Your account has been suspended for 24 hours due to multiple reports."); auth.signOut(); });
