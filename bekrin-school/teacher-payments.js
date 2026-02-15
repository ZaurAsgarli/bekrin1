// Firebase konfiqurasiyası
const firebaseConfig = {
  apiKey: "AIzaSyDE05ufg0FhPIAecIJ_ehr9yIFQKxIwncA",
  authDomain: "bekrinschool.firebaseapp.com",
  projectId: "bekrinschool",
  storageBucket: "bekrinschool.firebasestorage.app",
  messagingSenderId: "678081137706",
  appId: "1:678081137706:web:75601b998dde21f25f0753",
};

// Firebase initialize
if (!firebase.apps.length) {
  firebase.initializeApp(firebaseConfig);
}

const auth = firebase.auth();
const db = firebase.firestore();

let currentUser = null;
let allPayments = [];
let allStudents = [];
let allGroups = [];

// UI elementlər
const addPaymentBtn = document.getElementById("addPaymentBtn");
const paymentModal = document.getElementById("paymentModal");
const paymentForm = document.getElementById("paymentForm");
const closeModalBtn = document.getElementById("closeModalBtn");
const cancelBtn = document.getElementById("cancelBtn");
const groupFilter = document.getElementById("groupFilter");
const studentFilter = document.getElementById("studentFilter");
const paymentsBody = document.getElementById("paymentsBody");
const studentSelect = document.getElementById("studentSelect");
const paymentDate = document.getElementById("paymentDate");
const amount = document.getElementById("amount");
const paymentMethod = document.getElementById("paymentMethod");
const paymentStatus = document.getElementById("paymentStatus");
const paymentNote = document.getElementById("paymentNote");
const paymentNumberInfo = document.getElementById("paymentNumberInfo");
const paymentNumberText = document.getElementById("paymentNumberText");

// Bugünkü tarixi təyin et
paymentDate.valueAsDate = new Date();

// Auth yoxlama
auth.onAuthStateChanged(async (user) => {
  if (!user) {
    window.location.href = "index.html";
    return;
  }

  const userDoc = await db.collection("users").doc(user.email).get();
  if (!userDoc.exists || userDoc.data().role !== "teacher") {
    alert("Bu səhifəyə yalnız müəllimlər daxil ola bilər!");
    window.location.href = "index.html";
    return;
  }

  currentUser = user;
  await loadData();
});

// Məlumatları yüklə
async function loadData() {
  try {
    // Qrupları yüklə
    const groupsSnapshot = await db
      .collection("groups")
      .where("teacherEmail", "==", currentUser.email)
      .where("active", "==", true)
      .get();

    allGroups = [];
    groupsSnapshot.forEach((doc) => {
      allGroups.push({ id: doc.id, ...doc.data() });
    });

    // Şagirdləri yüklə
    const studentsSnapshot = await db
      .collection("students")
      .where("status", "==", "active")
      .get();

    allStudents = [];
    studentsSnapshot.forEach((doc) => {
      allStudents.push({ email: doc.id, ...doc.data() });
    });

    // Ödənişləri yüklə
    await loadPayments();

    // Filterləri doldur
    populateFilters();
  } catch (error) {
    console.error("Məlumat yüklənərkən xəta:", error);
    paymentsBody.innerHTML =
      '<tr><td colspan="8" class="empty-state">Xəta baş verdi</td></tr>';
  }
}

// Ödənişləri yüklə
async function loadPayments() {
  try {
    const snapshot = await db
      .collection("payments")
      .where("teacherEmail", "==", currentUser.email)
      .get();

    allPayments = [];
    snapshot.forEach((doc) => {
      allPayments.push({ id: doc.id, ...doc.data() });
    });

    // JavaScript-də sırala (ən yeni əvvəl)
    allPayments.sort((a, b) => {
      const dateA = new Date(a.date || "1970-01-01");
      const dateB = new Date(b.date || "1970-01-01");
      return dateB - dateA;
    });

    displayPayments();
  } catch (error) {
    console.error("Ödənişlər yüklənərkən xəta:", error);
    paymentsBody.innerHTML =
      '<tr><td colspan="8" class="empty-state">Xəta baş verdi</td></tr>';
  }
}

// Ödənişləri göstər
function displayPayments() {
  const groupFilterValue = groupFilter.value;
  const studentFilterValue = studentFilter.value;

  let filtered = allPayments;

  if (groupFilterValue) {
    filtered = filtered.filter((p) => p.groupId === groupFilterValue);
  }

  if (studentFilterValue) {
    filtered = filtered.filter((p) => p.studentEmail === studentFilterValue);
  }

  if (filtered.length === 0) {
    paymentsBody.innerHTML =
      '<tr><td colspan="8" class="empty-state">Ödəniş yoxdur</td></tr>';
    return;
  }

  paymentsBody.innerHTML = filtered
    .map((payment) => {
      const statusClass =
        payment.status === "paid" ? "status-paid" : "status-pending";
      const statusText = payment.status === "paid" ? "Ödənilib" : "Gözləmədə";
      const methodText =
        payment.method === "cash"
          ? "Nağd"
          : payment.method === "card"
          ? "Kart"
          : "Bank";

      return `
            <tr>
                <td>${payment.date}</td>
                <td>${payment.studentName}</td>
                <td>${payment.groupName || "N/A"}</td>
                <td><strong>${payment.paymentNumber || "N/A"}</strong></td>
                <td><strong>${payment.amount} AZN</strong></td>
                <td>${methodText}</td>
                <td><span class="status-badge ${statusClass}">${statusText}</span></td>
                <td>
                    <button class="delete-btn" onclick="deletePayment('${
                      payment.id
                    }')">🗑️ Sil</button>
                </td>
            </tr>
        `;
    })
    .join("");
}

// Filterləri doldur
function populateFilters() {
  // Qrup filtri
  groupFilter.innerHTML = '<option value="">Bütün qruplar</option>';
  allGroups.forEach((group) => {
    groupFilter.innerHTML += `<option value="${group.id}">${group.name}</option>`;
  });

  // Şagird filtri
  studentFilter.innerHTML = '<option value="">Bütün şagirdlər</option>';
  allStudents.forEach((student) => {
    studentFilter.innerHTML += `<option value="${student.email}">${student.fullName}</option>`;
  });

  // Modal şagird seçimi
  studentSelect.innerHTML = '<option value="">Şagird seçin...</option>';
  allStudents.forEach((student) => {
    studentSelect.innerHTML += `<option value="${student.email}">${student.fullName}</option>`;
  });
}

// Filter dəyişiklikləri
groupFilter.addEventListener("change", displayPayments);
studentFilter.addEventListener("change", displayPayments);

// Şagird seçildikdə ödəniş nömrəsini göstər
studentSelect.addEventListener("change", async () => {
  const selectedEmail = studentSelect.value;

  if (!selectedEmail) {
    paymentNumberInfo.style.display = "none";
    return;
  }

  try {
    // Bu şagirdin ödənişlərini say
    const snapshot = await db
      .collection("payments")
      .where("studentEmail", "==", selectedEmail)
      .get();

    const paymentCount = snapshot.size;
    const nextPaymentNumber = paymentCount + 1;

    // Ödəniş nömrəsini göstər
    paymentNumberText.textContent = `${nextPaymentNumber}-ci ödəniş`;
    paymentNumberInfo.style.display = "block";
  } catch (error) {
    console.error("Ödəniş sayı hesablanarkən xəta:", error);
    paymentNumberInfo.style.display = "none";
  }
});

// Modal aç
addPaymentBtn.addEventListener("click", () => {
  paymentForm.reset();
  paymentDate.valueAsDate = new Date();
  paymentNumberInfo.style.display = "none";
  paymentModal.classList.add("active");
});

// Modal bağla
closeModalBtn.addEventListener("click", () => {
  paymentModal.classList.remove("active");
});

cancelBtn.addEventListener("click", () => {
  paymentModal.classList.remove("active");
});

// Form submit
paymentForm.addEventListener("submit", async (e) => {
  e.preventDefault();

  const selectedEmail = studentSelect.value;
  const selectedStudent = allStudents.find((s) => s.email === selectedEmail);

  if (!selectedStudent) {
    alert("Şagird seçin!");
    return;
  }

  try {
    // Bu şagirdin ödənişlərini say
    const snapshot = await db
      .collection("payments")
      .where("studentEmail", "==", selectedEmail)
      .get();

    const paymentCount = snapshot.size;
    const paymentNumber = `${paymentCount + 1}-ci ödəniş`;

    // Şagirdin qrupunu tap
    let studentGroup = null;
    for (const group of allGroups) {
      if (group.students && group.students.includes(selectedEmail)) {
        studentGroup = group;
        break;
      }
    }

    // Ödənişi saxla
    await db.collection("payments").add({
      studentEmail: selectedEmail,
      studentName: selectedStudent.fullName,
      groupId: studentGroup?.id || null,
      groupName: studentGroup?.name || "Qrup yoxdur",
      paymentNumber: paymentNumber,
      date: paymentDate.value,
      amount: parseFloat(amount.value),
      method: paymentMethod.value,
      status: paymentStatus.value,
      note: paymentNote.value,
      teacherEmail: currentUser.email,
      createdAt: firebase.firestore.FieldValue.serverTimestamp(),
    });

    // Şagirdin balansını yenilə
    const currentBalance = selectedStudent.balance || 0;
    await db
      .collection("students")
      .doc(selectedEmail)
      .update({
        balance: currentBalance + parseFloat(amount.value),
      });

    // ✅ Ödəniş bildirişi göndər
    await sendPaymentNotification(
      selectedEmail,
      selectedStudent.fullName,
      parseFloat(amount.value),
      paymentDate.value
    );

    alert("✅ Ödəniş əlavə edildi!");
    paymentModal.classList.remove("active");
    await loadPayments();
  } catch (error) {
    console.error("Ödəniş əlavə edilərkən xəta:", error);
    alert("Xəta baş verdi!");
  }
});

// Ödənişi sil
window.deletePayment = async function (paymentId) {
  if (!confirm("Bu ödənişi silmək istədiyinizə əminsiniz?")) {
    return;
  }

  try {
    const payment = allPayments.find((p) => p.id === paymentId);

    // Şagirdin balansından çıxar
    const studentDoc = await db
      .collection("students")
      .doc(payment.studentEmail)
      .get();
    if (studentDoc.exists) {
      const currentBalance = studentDoc.data().balance || 0;
      await db
        .collection("students")
        .doc(payment.studentEmail)
        .update({
          balance: currentBalance - payment.amount,
        });
    }

    // Ödənişi sil
    await db.collection("payments").doc(paymentId).delete();

    alert("✅ Ödəniş silindi!");
    await loadPayments();
  } catch (error) {
    console.error("Ödəniş silinərkən xəta:", error);
    alert("Xəta baş verdi!");
  }
};

// ✅ Ödəniş bildirişi göndər funksiyası
async function sendPaymentNotification(
  studentEmail,
  studentName,
  amount,
  date
) {
  try {
    // Tarixi dd.mm.yyyy formatına çevir
    const formattedDate = new Date(date).toLocaleDateString("az-AZ", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
    });

    const message = `${amount} AZN məbləğində ödəniş qeydə alındı. (${formattedDate})`;

    // Şagird üçün bildiriş
    await db.collection("notifications").add({
      recipientEmail: studentEmail,
      studentEmail: studentEmail,
      studentName: studentName,
      type: "payment",
      message: message,
      amount: amount,
      date: date,
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
        type: "payment",
        message: message,
        amount: amount,
        date: date,
        timestamp: firebase.firestore.FieldValue.serverTimestamp(),
        read: false,
      });
    }

    console.log("✅ Ödəniş bildirişi göndərildi:", studentName);
  } catch (error) {
    console.error("Ödəniş bildirişi xətası:", error);
  }
}
