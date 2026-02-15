// Firebase konfiqurasiyası
const firebaseConfig = {
  apiKey: "AIzaSyDE05ufg0FhPIAecIJ_ehr9yIFQKxIwncA",
  authDomain: "bekrinschool.firebaseapp.com",
  projectId: "bekrinschool",
  storageBucket: "bekrinschool.firebasestorage.app",
  messagingSenderId: "678081137706",
  appId: "1:678081137706:web:75601b998dde21f25f0753",
};

if (!firebase.apps.length) {
  firebase.initializeApp(firebaseConfig);
}

const auth = firebase.auth();
const db = firebase.firestore();

// Global variables
let currentUser = null;
let studentGroups = [];
let allAttendanceRecords = [];

// DOM elements
const statsContainer = document.getElementById("statsContainer");
const progressContainer = document.getElementById("progressContainer");
const progressBarFill = document.getElementById("progressBarFill");
const progressPercentage = document.getElementById("progressPercentage");
const attendanceTableContainer = document.getElementById(
  "attendanceTableContainer"
);

const statPresent = document.getElementById("statPresent");
const statLate = document.getElementById("statLate");
const statAbsent = document.getElementById("statAbsent");
const statExcused = document.getElementById("statExcused");

// Auth check
auth.onAuthStateChanged(async (user) => {
  if (!user) {
    window.location.href = "index.html";
    return;
  }

  currentUser = user;

  const userDoc = await db.collection("users").doc(user.email).get();
  if (!userDoc.exists || userDoc.data().role !== "student") {
    alert("Bu səhifəyə yalnız şagirdlər daxil ola bilər!");
    await auth.signOut();
    window.location.href = "index.html";
    return;
  }

  await loadStudentAttendance();
});

// Load student's attendance data
async function loadStudentAttendance() {
  try {
    console.log("Loading attendance for:", currentUser.email);

    // Get student's groups
    const groupsSnapshot = await db
      .collection("groups")
      .where("students", "array-contains", currentUser.email)
      .where("active", "==", true)
      .get();

    studentGroups = groupsSnapshot.docs.map((doc) => ({
      id: doc.id,
      ...doc.data(),
    }));

    console.log(`Found ${studentGroups.length} groups`);

    if (studentGroups.length === 0) {
      showEmptyState("Siz hələ heç bir qrupa əlavə edilməmisiniz.");
      return;
    }

    // Load attendance records for all groups
    allAttendanceRecords = [];

    for (const group of studentGroups) {
      const attendanceDoc = await db
        .collection("attendance")
        .doc(group.id)
        .get();

      if (attendanceDoc.exists) {
        const attendanceData = attendanceDoc.data();
        const months = attendanceData.months || [];
        const data = attendanceData.data || {};

        // Extract student's records
        const studentData = data[currentUser.email] || {};

        // Process each month
        months.forEach((month, monthIndex) => {
          month.columns.forEach((column, columnIndex) => {
            const key = `${monthIndex}_${columnIndex}`;
            const status = studentData[key];

            if (status && column.date) {
              allAttendanceRecords.push({
                groupId: group.id,
                groupName: group.name,
                date: column.date,
                timestamp: column.timestamp,
                status: status,
              });
            }
          });
        });
      }
    }

    console.log(`Found ${allAttendanceRecords.length} attendance records`);

    // Sort by date (newest first)
    allAttendanceRecords.sort((a, b) => b.timestamp - a.timestamp);

    // Display data
    displayStats();
    displayAttendanceTable();
  } catch (error) {
    console.error("Davamiyyət yüklənərkən xəta:", error);
    showEmptyState("Davamiyyət yüklənə bilmədi: " + error.message);
  }
}

// Display statistics
function displayStats() {
  if (allAttendanceRecords.length === 0) {
    progressContainer.style.display = "none";
    return;
  }

  // Count statuses
  const stats = {
    present: 0,
    late: 0,
    absent: 0,
    excused: 0,
  };

  allAttendanceRecords.forEach((record) => {
    if (stats[record.status] !== undefined) {
      stats[record.status]++;
    }
  });

  // Update stat cards
  statPresent.textContent = stats.present;
  statLate.textContent = stats.late;
  statAbsent.textContent = stats.absent;
  statExcused.textContent = stats.excused;

  // Calculate attendance percentage
  const totalClasses = allAttendanceRecords.length;
  const attendedClasses = stats.present + stats.late + stats.excused;
  const percentage =
    totalClasses > 0 ? Math.round((attendedClasses / totalClasses) * 100) : 0;

  // Update progress bar
  progressContainer.style.display = "block";
  progressPercentage.textContent = `${percentage}%`;
  progressBarFill.style.width = `${percentage}%`;
  progressBarFill.textContent = `${percentage}%`;

  // Change color based on percentage
  if (percentage >= 80) {
    progressBarFill.style.background =
      "linear-gradient(90deg, #10b981 0%, #059669 100%)";
  } else if (percentage >= 60) {
    progressBarFill.style.background =
      "linear-gradient(90deg, #f59e0b 0%, #d97706 100%)";
  } else {
    progressBarFill.style.background =
      "linear-gradient(90deg, #ef4444 0%, #dc2626 100%)";
  }

  console.log(`Statistics: ${percentage}% attendance`);
}

// Display attendance table
function displayAttendanceTable() {
  if (allAttendanceRecords.length === 0) {
    showEmptyState("Hələ heç bir davamiyyət qeydi yoxdur.");
    return;
  }

  const tableHTML = `
    <table class="attendance-table">
      <thead>
        <tr>
          <th>Tarix</th>
          <th>Qrup</th>
          <th>Status</th>
        </tr>
      </thead>
      <tbody>
        ${allAttendanceRecords
          .map((record) => {
            const date = new Date(record.date).toLocaleDateString("az-AZ", {
              day: "2-digit",
              month: "2-digit",
              year: "numeric",
            });

            return `
              <tr>
                <td class="date-cell">${date}</td>
                <td class="group-cell">${record.groupName}</td>
                <td>${getStatusBadge(record.status)}</td>
              </tr>
            `;
          })
          .join("")}
      </tbody>
    </table>
  `;

  attendanceTableContainer.innerHTML = tableHTML;
}

// Get status badge HTML
function getStatusBadge(status) {
  const badges = {
    present:
      '<span class="status-badge present"><i class="fas fa-check-circle"></i> Dərsdə</span>',
    late: '<span class="status-badge late"><i class="fas fa-clock"></i> Gecikdi</span>',
    absent:
      '<span class="status-badge absent"><i class="fas fa-times-circle"></i> Gəlmədi</span>',
    excused:
      '<span class="status-badge excused"><i class="fas fa-file-medical"></i> Üzrlü</span>',
  };

  return badges[status] || status;
}

// Show empty state
function showEmptyState(message) {
  attendanceTableContainer.innerHTML = `
    <div class="empty-state">
      <i class="fas fa-calendar-times"></i>
      <h3>${message}</h3>
    </div>
  `;

  progressContainer.style.display = "none";
}
