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
let currentGroup = null;
let allGroups = [];
let attendanceMonths = [];
let attendanceData = {};
let studentNames = {};
let currentDateCell = null;

// DOM elements
const groupsSection = document.getElementById("groupsSection");
const groupsGrid = document.getElementById("groupsGrid");
const attendanceSection = document.getElementById("attendanceSection");
const groupNameHeader = document.getElementById("groupName");
const attendanceTable = document.getElementById("attendanceTable");
const dateModal = document.getElementById("dateModal");
const dateInput = document.getElementById("dateInput");

// Auth check
auth.onAuthStateChanged(async (user) => {
  if (!user) {
    window.location.href = "index.html";
    return;
  }

  currentUser = user;

  const userDoc = await db.collection("users").doc(user.email).get();
  if (!userDoc.exists || userDoc.data().role !== "teacher") {
    alert("Bu səhifəyə yalnız müəllimlər daxil ola bilər!");
    await auth.signOut();
    window.location.href = "index.html";
    return;
  }

  loadGroups();
});

// Load groups
async function loadGroups() {
  try {
    const snapshot = await db
      .collection("groups")
      .where("teacherEmail", "==", currentUser.email)
      .where("active", "==", true)
      .get();

    allGroups = snapshot.docs.map((doc) => ({
      id: doc.id,
      ...doc.data(),
    }));

    allGroups.sort((a, b) => {
      if (a.order !== undefined && b.order !== undefined) {
        return a.order - b.order;
      }
      return (a.name || "").localeCompare(b.name || "");
    });

    displayGroups();
  } catch (error) {
    console.error("Qruplar yüklənərkən xəta:", error);
    alert("Qruplar yüklənə bilmədi: " + error.message);
  }
}

// Display groups
function displayGroups() {
  if (allGroups.length === 0) {
    groupsGrid.innerHTML = `
      <div class="empty-state">
        <i class="fas fa-users-slash"></i>
        <h3>Heç bir qrup tapılmadı</h3>
      </div>
    `;
    return;
  }

  groupsGrid.innerHTML = allGroups
    .map((group) => {
      const studentCount = (group.students || []).length;
      return `
        <div class="group-card" onclick="selectGroup('${group.id}')">
          <div class="group-card-name">${group.name}</div>
          <div class="group-card-info">
            <i class="fas fa-user-graduate"></i> ${studentCount} şagird
          </div>
        </div>
      `;
    })
    .join("");
}

// Select group
async function selectGroup(groupId) {
  try {
    const group = allGroups.find((g) => g.id === groupId);
    if (!group) {
      alert("Qrup tapılmadı!");
      return;
    }

    currentGroup = group;

    groupsSection.style.display = "none";
    attendanceSection.classList.add("active");
    groupNameHeader.innerHTML = `<i class="fas fa-calendar-check"></i> ${group.name} - Davamiyyət`;

    await loadStudentNames();
    await loadAttendanceData();
    renderTable();
  } catch (error) {
    console.error("Qrup seçilərkən xəta:", error);
    alert("Xəta: " + error.message);
  }
}

// Load student names from Firestore
async function loadStudentNames() {
  try {
    const students = currentGroup.students || [];
    studentNames = {};

    for (const email of students) {
      const userDoc = await db.collection("users").doc(email).get();
      if (userDoc.exists) {
        const userData = userDoc.data();
        studentNames[email] = userData.fullName || email.split("@")[0];
      } else {
        studentNames[email] = email.split("@")[0];
      }
    }
  } catch (error) {
    console.error("Şagird adları yüklənərkən xəta:", error);
  }
}

// Load attendance data from Firestore
async function loadAttendanceData() {
  try {
    const docRef = db.collection("attendance").doc(currentGroup.id);
    const doc = await docRef.get();

    if (doc.exists) {
      const data = doc.data();
      attendanceMonths = data.months || [];
      attendanceData = data.data || {};
    } else {
      attendanceMonths = [createNewMonth(1)];
      attendanceData = {};
      await saveAttendanceData();
    }

    attendanceMonths.forEach((month) => {
      if (!month.columns) month.columns = createEmptyColumns();
      if (month.collapsed === undefined) month.collapsed = false;
    });
  } catch (error) {
    console.error("Davamiyyət yüklənərkən xəta:", error);
    attendanceMonths = [createNewMonth(1)];
    attendanceData = {};
  }
}

// Create new month object
function createNewMonth(monthNumber) {
  return {
    monthNumber: monthNumber,
    columns: createEmptyColumns(),
    collapsed: false,
  };
}

// Create 8 empty columns
function createEmptyColumns() {
  return Array(8)
    .fill(null)
    .map(() => ({
      timestamp: null,
      date: null,
    }));
}

// Render table
function renderTable() {
  const students = currentGroup.students || [];

  if (students.length === 0) {
    attendanceTable.innerHTML = `
      <tr><td colspan="100" class="empty-state">
        <i class="fas fa-user-slash"></i>
        <p>Bu qrupda şagird yoxdur</p>
      </td></tr>
    `;
    return;
  }

  let tableHTML = `<thead><tr><th class="student-name-cell">Ad Soyad</th>`;

  attendanceMonths.forEach((month, monthIndex) => {
    const collapseClass = month.collapsed ? "collapsed" : "";
    tableHTML += `
      <th colspan="8" class="month-header-cell ${collapseClass}" onclick="toggleMonth(${monthIndex})">
        <div class="month-header-content">
          <i class="fas fa-chevron-${month.collapsed ? "right" : "down"}"></i>
          ${month.collapsed ? month.monthNumber : "Ay: " + month.monthNumber}
        </div>
      </th>
    `;
  });

  tableHTML += `</tr><tr><th class="student-name-cell"></th>`;

  attendanceMonths.forEach((month, monthIndex) => {
    const collapseClass = month.collapsed ? "collapsed" : "";
    month.columns.forEach((col, colIndex) => {
      const dateDisplay = col.date
        ? new Date(col.date).toLocaleDateString("az-AZ", {
            day: "2-digit",
            month: "2-digit",
          })
        : "?";
      tableHTML += `
        <th class="date-cell month-columns month-${monthIndex} ${collapseClass}" onclick="openDateModal(${monthIndex}, ${colIndex})">
          <div class="date-cell-content">
            <div class="date-display">${dateDisplay}</div>
            <div class="date-placeholder">Click</div>
          </div>
        </th>
      `;
    });
  });

  tableHTML += `</tr></thead><tbody>`;

  students.forEach((studentEmail) => {
    tableHTML += `<tr><td class="student-name-cell">${
      studentNames[studentEmail] || studentEmail
    }</td>`;

    attendanceMonths.forEach((month, monthIndex) => {
      const collapseClass = month.collapsed ? "collapsed" : "";
      month.columns.forEach((col, colIndex) => {
        const key = `${monthIndex}_${colIndex}`;
        const status =
          attendanceData[studentEmail] && attendanceData[studentEmail][key]
            ? attendanceData[studentEmail][key]
            : "";
        const statusClass = status ? status : "";
        const statusText = getStatusText(status);

        tableHTML += `
          <td class="status-cell ${statusClass} month-columns month-${monthIndex} ${collapseClass}" 
              onclick="openStatusDropdown(event, '${studentEmail}', ${monthIndex}, ${colIndex})">
            ${statusText}
          </td>
        `;
      });
    });

    tableHTML += `</tr>`;
  });

  tableHTML += `</tbody>`;

  attendanceTable.innerHTML = tableHTML;
}

// Get status text
function getStatusText(status) {
  switch (status) {
    case "present":
      return "✓";
    case "late":
      return "⏰";
    case "absent":
      return "✗";
    case "excused":
      return "📄";
    default:
      return "-";
  }
}

// Toggle month collapse/expand
function toggleMonth(monthIndex) {
  attendanceMonths[monthIndex].collapsed =
    !attendanceMonths[monthIndex].collapsed;
  renderTable();
}

// Open date modal
function openDateModal(monthIndex, columnIndex) {
  currentDateCell = { monthIndex, columnIndex };

  const column = attendanceMonths[monthIndex].columns[columnIndex];
  if (column.date) {
    dateInput.value = column.date;
  } else {
    dateInput.value = new Date().toISOString().split("T")[0];
  }

  dateModal.classList.add("active");
}

// Close date modal
function closeDateModal() {
  dateModal.classList.remove("active");
  currentDateCell = null;
}

// Confirm date selection
async function confirmDate() {
  if (!currentDateCell || !dateInput.value) {
    alert("Tarix seçilməyib!");
    return;
  }

  const { monthIndex, columnIndex } = currentDateCell;
  const selectedDate = dateInput.value;
  const timestamp = new Date(selectedDate).getTime();

  attendanceMonths[monthIndex].columns[columnIndex] = {
    timestamp: timestamp,
    date: selectedDate,
  };

  await saveAttendanceData();
  renderTable();
  closeDateModal();
}

// Open status dropdown
function openStatusDropdown(event, studentEmail, monthIndex, columnIndex) {
  event.stopPropagation();

  document.querySelectorAll(".status-dropdown.active").forEach((dropdown) => {
    if (dropdown.id !== "statusDropdownTemplate") {
      dropdown.remove();
    }
  });

  const template = document.getElementById("statusDropdownTemplate");
  const dropdown = template.cloneNode(true);
  dropdown.id = "";
  dropdown.classList.add("active");

  const cell = event.currentTarget;
  cell.style.position = "relative";
  cell.appendChild(dropdown);

  setTimeout(() => {
    const cellRect = cell.getBoundingClientRect();
    const viewportHeight = window.innerHeight;
    const dropdownHeight = 220;

    if (cellRect.bottom + dropdownHeight > viewportHeight) {
      dropdown.style.top = "auto";
      dropdown.style.bottom = "100%";
      dropdown.style.marginTop = "0";
      dropdown.style.marginBottom = "5px";
    }
  }, 0);

  dropdown.querySelectorAll(".status-option").forEach((option) => {
    option.onclick = async (e) => {
      e.stopPropagation();
      const status = option.getAttribute("data-status");

      if (status === "clear") {
        await clearStatus(studentEmail, monthIndex, columnIndex);
      } else {
        await updateStatus(studentEmail, monthIndex, columnIndex, status);
      }

      dropdown.remove();
    };
  });

  setTimeout(() => {
    document.addEventListener(
      "click",
      function closeDropdown(e) {
        if (!dropdown.contains(e.target)) {
          dropdown.remove();
          document.removeEventListener("click", closeDropdown);
        }
      },
      { once: false }
    );
  }, 100);
}

// Update status
async function updateStatus(studentEmail, monthIndex, columnIndex, status) {
  try {
    const key = `${monthIndex}_${columnIndex}`;

    if (!attendanceData[studentEmail]) {
      attendanceData[studentEmail] = {};
    }
    attendanceData[studentEmail][key] = status;

    await saveAttendanceData();

    // ✅ Bildiriş göndər
    await sendAttendanceNotification(
      studentEmail,
      monthIndex,
      columnIndex,
      status
    );

    renderTable();

    console.log(`✅ Status updated: ${studentEmail} - ${key} - ${status}`);
  } catch (error) {
    console.error("Status yenilənərkən xəta:", error);
    alert("Status yenilənə bilmədi: " + error.message);
  }
}

// Clear status
async function clearStatus(studentEmail, monthIndex, columnIndex) {
  try {
    const key = `${monthIndex}_${columnIndex}`;

    if (attendanceData[studentEmail] && attendanceData[studentEmail][key]) {
      delete attendanceData[studentEmail][key];
    }

    await saveAttendanceData();
    renderTable();

    console.log(`✅ Status cleared: ${studentEmail} - ${key}`);
  } catch (error) {
    console.error("Status silinərkən xəta:", error);
    alert("Status silinə bilmədi: " + error.message);
  }
}

// ✅ Send attendance notification to student and parent
async function sendAttendanceNotification(
  studentEmail,
  monthIndex,
  columnIndex,
  status
) {
  try {
    const column = attendanceMonths[monthIndex].columns[columnIndex];
    const date = column.date
      ? new Date(column.date).toLocaleDateString("az-AZ", {
          day: "2-digit",
          month: "2-digit",
          year: "numeric",
        })
      : new Date().toLocaleDateString("az-AZ");

    const studentName = studentNames[studentEmail] || studentEmail;

    const statusMessages = {
      present: `${date} tarixində ${currentGroup.name} qrupunda dərsdə iştirak etdi.`,
      late: `${date} tarixində ${currentGroup.name} qrupuna gecikmə ilə gəldi.`,
      absent: `${date} tarixində ${currentGroup.name} qrupuna gəlmədi.`,
      excused: `${date} tarixində ${currentGroup.name} qrupuna üzrlü olaraq gəlmədi.`,
    };

    const message = statusMessages[status] || `Davamiyyət qeydi yeniləndi.`;

    // Şagird üçün bildiriş
    await db.collection("notifications").add({
      recipientEmail: studentEmail,
      studentEmail: studentEmail,
      studentName: studentName,
      type: "attendance",
      attendanceType: status,
      message: message,
      date: column.date || new Date().toISOString().split("T")[0],
      groupName: currentGroup.name,
      timestamp: firebase.firestore.FieldValue.serverTimestamp(),
      read: false,
    });

    // Valideyn üçün bildiriş
    const studentDoc = await db.collection("students").doc(studentEmail).get();
    if (studentDoc.exists && studentDoc.data().parentEmail) {
      await db.collection("notifications").add({
        recipientEmail: studentDoc.data().parentEmail,
        studentEmail: studentEmail,
        studentName: studentName,
        type: "attendance",
        attendanceType: status,
        message: message,
        date: column.date || new Date().toISOString().split("T")[0],
        groupName: currentGroup.name,
        timestamp: firebase.firestore.FieldValue.serverTimestamp(),
        read: false,
      });
    }

    console.log("✅ Bildiriş göndərildi:", studentName, status);
  } catch (error) {
    console.error("Bildiriş göndərilən xəta:", error);
  }
}

// Save attendance data to Firestore
async function saveAttendanceData() {
  try {
    const docRef = db.collection("attendance").doc(currentGroup.id);
    await docRef.set(
      {
        groupId: currentGroup.id,
        groupName: currentGroup.name,
        months: attendanceMonths,
        data: attendanceData,
        lastUpdated: firebase.firestore.FieldValue.serverTimestamp(),
      },
      { merge: true }
    );

    console.log("✅ Davamiyyət məlumatları saxlanıldı");
  } catch (error) {
    console.error("Davamiyyət saxlanarkən xəta:", error);
    throw error;
  }
}

// Add new month
async function addNewMonth() {
  try {
    const nextMonthNumber = attendanceMonths.length + 1;
    const newMonth = createNewMonth(nextMonthNumber);
    attendanceMonths.push(newMonth);

    await saveAttendanceData();
    renderTable();

    console.log(`✅ Yeni ay əlavə edildi: Ay ${nextMonthNumber}`);
  } catch (error) {
    console.error("Ay əlavə edilərkən xəta:", error);
    alert("Ay əlavə edilə bilmədi: " + error.message);
  }
}

// Close dropdown when clicking outside
document.addEventListener("click", (e) => {
  if (!e.target.closest(".status-cell")) {
    document.querySelectorAll(".status-dropdown.active").forEach((dropdown) => {
      if (dropdown.id !== "statusDropdownTemplate") {
        dropdown.remove();
      }
    });
  }
});

// Set today's date as default in date input
dateInput.valueAsDate = new Date();
