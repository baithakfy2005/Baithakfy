// IMPORTANT: Set your admin password here
const ADMIN_PASSWORD = "DBRT@1987#JAANU"; 

// Firebase Config is not needed here anymore for database access,
// as all data is fetched securely through the server.

// --- DOM Elements ---
const passwordPrompt = document.getElementById('password-prompt');
const adminPanel = document.getElementById('admin-panel');
const passwordInput = document.getElementById('admin-password-input');
const loginButton = document.getElementById('admin-login-button');
const adminError = document.getElementById('admin-error');

const navButtons = document.querySelectorAll('.nav-button');
const views = document.querySelectorAll('.view');

const totalUsersStat = document.getElementById('total-users-stat');
const totalReportsStat = document.getElementById('total-reports-stat');
const suspendedUsersStat = document.getElementById('suspended-users-stat');
const usersTableBody = document.getElementById('users-table-body');
const reportsTableBody = document.getElementById('reports-table-body');

let socket;

// --- Admin Login ---
loginButton.addEventListener('click', () => {
    if (passwordInput.value.trim() === ADMIN_PASSWORD) {
        passwordPrompt.classList.add('hidden');
        adminPanel.classList.remove('hidden');
        initializeApp();
    } else {
        adminError.textContent = "Incorrect password.";
        passwordInput.value = "";
    }
});

// --- Initialize App after Login ---
function initializeApp() {
    socket = io();
    setupEventListeners();
    // Request initial data for the dashboard
    socket.emit('adminGetDashboardData');
}

// --- Navigation and Event Listeners ---
function setupEventListeners() {
    // Navigation logic
    navButtons.forEach(button => {
        button.addEventListener('click', () => {
            navButtons.forEach(btn => btn.classList.remove('active'));
            views.forEach(view => view.classList.add('hidden'));
            button.classList.add('active');
            const viewId = button.id.replace('nav-', '') + '-view';
            document.getElementById(viewId).classList.remove('hidden');

            // Request data for the activated view from server
            if (viewId === 'users-view') socket.emit('adminGetUsers');
            if (viewId === 'reports-view') socket.emit('adminGetReports');
        });
    });
    
    // Setup listeners for suspend/unsuspend buttons
    addUserActionListeners();

    // Listen for data coming FROM the server
    socket.on('adminReceiveDashboardData', renderDashboardData);
    socket.on('adminReceiveUsers', renderUsersData);
    socket.on('adminReceiveReports', renderReportsData);
    socket.on('userStatusChanged', () => {
        // Reload data if the current view is user management
        if (!document.getElementById('users-view').classList.contains('hidden')) {
            socket.emit('adminGetUsers');
        }
        // Always reload dashboard stats
        socket.emit('adminGetDashboardData');
    });
}

// --- Data Rendering Functions (These now receive data from server) ---
function renderDashboardData(data) {
    totalUsersStat.textContent = data.totalUsers;
    totalReportsStat.textContent = data.totalReports;
    suspendedUsersStat.textContent = data.suspendedUsers;
}

function renderUsersData(usersArray) {
    // Sort the data here in JavaScript
    usersArray.sort((a, b) => {
        const timeA = a.createdAt ? a.createdAt._seconds : 0;
        const timeB = b.createdAt ? b.createdAt._seconds : 0;
        return timeB - timeA; // Newest first
    });
    
    let html = '';
    if (usersArray.length === 0) {
        usersTableBody.innerHTML = '<tr><td colspan="5">No users found.</td></tr>';
        return;
    }

    usersArray.forEach(user => {
        const isSuspended = user.status === 'suspended';
        html += `
            <tr>
                <td>${user.email}</td>
                <td>${user.name || 'N/A'}</td>
                <td>${user.reportCount || 0}</td>
                <td class="status-${isSuspended ? 'suspended' : 'active'}">${isSuspended ? 'Suspended' : 'Active'}</td>
                <td>
                    ${isSuspended 
                        ? `<button class="action-button unsuspend-btn" data-uid="${user.uid}">Unsuspend</button>`
                        : `<button class="action-button suspend-btn" data-uid="${user.uid}">Suspend</button>`
                    }
                </td>
            </tr>
        `;
    });
    usersTableBody.innerHTML = html;
}

function renderReportsData(reportsArray) {
    // Sort the data here in JavaScript
    reportsArray.sort((a, b) => {
        const timeA = a.timestamp ? a.timestamp._seconds : 0;
        const timeB = b.timestamp ? b.timestamp._seconds : 0;
        return timeB - timeA; // Newest first
    });

    let html = '';
    if (reportsArray.length === 0) {
        reportsTableBody.innerHTML = '<tr><td colspan="4">No reports found.</td></tr>';
        return;
    }
    
    reportsArray.forEach(report => {
        const reportDate = report.timestamp ? new Date(report.timestamp._seconds * 1000).toLocaleString() : 'N/A';
        html += `
            <tr>
                <td>${reportDate}</td>
                <td>${report.reportedEmail}</td>
                <td>${report.reporterEmail}</td>
                <td>${report.reason.replace(/_/g, ' ')}</td>
            </tr>
        `;
    });
    reportsTableBody.innerHTML = html;
}

// --- Admin Actions ---
function addUserActionListeners() {
    usersTableBody.addEventListener('click', (e) => {
        const target = e.target;
        const uid = target.dataset.uid;
        if (!uid) return;
        if (target.classList.contains('suspend-btn')) {
            if (confirm(`Are you sure you want to suspend this user?`)) {
                socket.emit('adminSuspendUser', { uid });
            }
        }
        if (target.classList.contains('unsuspend-btn')) {
             if (confirm(`Are you sure you want to unsuspend this user?`)) {
                socket.emit('adminUnsuspendUser', { uid });
            }
        }
    });
}
