// Firebase konfiqurasiyası
const firebaseConfig = {
  apiKey: "AIzaSyDE05ufg0FhPIAecIJ_ehr9yIFQKxIwncA",
  authDomain: "bekrinschool.firebaseapp.com",
  projectId: "bekrinschool",
  storageBucket: "bekrinschool.firebasestorage.app",
  messagingSenderId: "678081137706",
  appId: "1:678081137706:web:75601b998dde21f25f0753",
};

// Firebase başlat
if (!firebase.apps.length) {
  firebase.initializeApp(firebaseConfig);
}

const auth = firebase.auth();
const db = firebase.firestore();

// Global dəyişənlər
let currentUser = null;
let allStudents = [];
let editingStudentId = null;

// DOM elementləri
const loadingScreen = document.getElementById("loadingScreen");
const mainContent = document.getElementById("mainContent");
const activeStudentsBody = document.getElementById("activeStudentsBody");
const deletedStudentsBody = document.getElementById("deletedStudentsBody");
const studentModal = document.getElementById("studentModal");
const studentForm = document.getElementById("studentForm");
const modalTitle = document.getElementById("modalTitle");
const passwordGroup = document.getElementById("passwordGroup");

// Auth yoxlama
auth.onAuthStateChanged(async (user) => {
  if (!user) {
    window.location.href = "index.html";
    return;
  }

  currentUser = user;

  // User rolunu yoxla
  const userDoc = await db.collection("users").doc(user.email).get();
  if (!userDoc.exists || userDoc.data().role !== "teacher") {
    alert("Bu səhifəyə yalnız müəllimlər daxil ola bilər!");
    await auth.signOut();
    window.location.href = "index.html";
    return;
  }

  loadStudents();
});

// Şagirdləri yüklə
async function loadStudents() {
  try {
    loadingScreen.style.display = "block";
    mainContent.style.display = "none";

    const snapshot = await db
      .collection("students")
      .where("createdBy", "==", currentUser.email)
      .get();

    allStudents = snapshot.docs.map((doc) => ({
      id: doc.id,
      ...doc.data(),
    }));

    displayStudents();

    loadingScreen.style.display = "none";
    mainContent.style.display = "block";
  } catch (error) {
    console.error("Şagirdlər yüklənərkən xəta:", error);
    alert("Şagirdlər yüklənə bilmədi: " + error.message);
  }
}

// Şagirdləri göstər
function displayStudents() {
  const activeStudents = allStudents.filter((s) => s.status === "active");
  const deletedStudents = allStudents.filter((s) => s.status === "deleted");

  // Aktiv şagirdlər
  if (activeStudents.length === 0) {
    activeStudentsBody.innerHTML =
      '<tr><td colspan="8" class="empty-state">Aktiv şagird yoxdur</td></tr>';
  } else {
    activeStudentsBody.innerHTML = activeStudents
      .map(
        (student, index) => `
            <tr>
                <td>${index + 1}</td>
                <td>${student.fullName}</td>
                <td><span class="class-badge">${
                  student.grade || student.class
                }-ci sinif</span></td>
                <td>${student.email}</td>
                <td>${student.phone || "-"}</td>
                <td>
                    <strong>${student.parentName || "-"}</strong><br>
                    <small>${student.parentEmail || "-"}</small><br>
                    <small>${student.parentPhone || "-"}</small>
                </td>
                <td class="balance ${student.balance < 0 ? "negative" : ""}">${
          student.balance || 0
        } AZN</td>
                <td>
                    <button class="action-btn edit-btn" onclick="openEditModal('${
                      student.id
                    }')">✏️ Düzəliş</button>
                    <button class="action-btn delete-btn" onclick="deleteStudent('${
                      student.id
                    }')">🗑️ Sil</button>
                </td>
            </tr>
        `
      )
      .join("");
  }

  // Silinmiş şagirdlər
  if (deletedStudents.length === 0) {
    deletedStudentsBody.innerHTML =
      '<tr><td colspan="7" class="empty-state">Silinmiş şagird yoxdur</td></tr>';
  } else {
    deletedStudentsBody.innerHTML = deletedStudents
      .map(
        (student, index) => `
            <tr>
                <td>${index + 1}</td>
                <td>${student.fullName}</td>
                <td><span class="class-badge">${
                  student.grade || student.class
                }-ci sinif</span></td>
                <td>${student.email}</td>
                <td>${student.phone || "-"}</td>
                <td>
                    <strong>${student.parentName || "-"}</strong><br>
                    <small>${student.parentEmail || "-"}</small>
                </td>
                <td>
                    <button class="action-btn restore-btn" onclick="restoreStudent('${
                      student.id
                    }')">↩️ Geri Qaytar</button>
                </td>
            </tr>
        `
      )
      .join("");
  }
}

// Tab dəyiş
function switchTab(tab) {
  const activeTab = document.getElementById("activeTab");
  const deletedTab = document.getElementById("deletedTab");
  const tabBtns = document.querySelectorAll(".tab-btn");

  if (tab === "active") {
    activeTab.style.display = "block";
    deletedTab.style.display = "none";
    tabBtns[0].classList.add("active");
    tabBtns[1].classList.remove("active");
  } else {
    activeTab.style.display = "none";
    deletedTab.style.display = "block";
    tabBtns[0].classList.remove("active");
    tabBtns[1].classList.add("active");
  }
}

// Yeni şagird əlavə et (modal aç)
function addStudent() {
  editingStudentId = null;
  modalTitle.textContent = "Yeni Şagird";
  studentForm.reset();
  passwordGroup.style.display = "block";
  document.getElementById("password").required = true;
  document.getElementById("studentEmail").disabled = false;
  document.getElementById("parentEmail").disabled = false;
  studentModal.classList.add("active");
}

// Düzəliş modalı aç
function openEditModal(studentId) {
  editingStudentId = studentId;
  const student = allStudents.find((s) => s.id === studentId);

  modalTitle.textContent = "Şagird Məlumatlarını Düzəlt";
  document.getElementById("studentName").value = student.fullName;
  document.getElementById("studentClass").value =
    student.grade || student.class;
  document.getElementById("studentEmail").value = student.email;
  document.getElementById("studentEmail").disabled = true;
  document.getElementById("studentPhone").value = student.phone || "";
  document.getElementById("parentName").value = student.parentName || "";
  document.getElementById("parentEmail").value = student.parentEmail || "";
  document.getElementById("parentEmail").disabled = true;
  document.getElementById("parentPhone").value = student.parentPhone || "";

  passwordGroup.style.display = "none";
  document.getElementById("password").required = false;

  studentModal.classList.add("active");
}

// Modal bağla
function closeModal() {
  studentModal.classList.remove("active");
  studentForm.reset();
  document.getElementById("studentEmail").disabled = false;
  document.getElementById("parentEmail").disabled = false;
  editingStudentId = null;
}

// Şagird yadda saxla
async function saveStudent(event) {
  event.preventDefault();

  try {
    const studentName = document.getElementById("studentName").value.trim();
    const studentClass = document.getElementById("studentClass").value.trim();
    const studentEmail = document
      .getElementById("studentEmail")
      .value.trim()
      .toLowerCase();
    const studentPhone = document.getElementById("studentPhone").value.trim();
    const parentName = document.getElementById("parentName").value.trim();
    const parentEmail = document
      .getElementById("parentEmail")
      .value.trim()
      .toLowerCase();
    const parentPhone = document.getElementById("parentPhone").value.trim();
    const password = document.getElementById("password").value;

    // Validasiya
    if (!studentName || !studentClass || !studentEmail) {
      alert("⚠️ Zəruri sahələr doldurulmalıdır!");
      return;
    }

    if (editingStudentId) {
      // ========== REDAKTƏ REJIMI ==========
      console.log("📝 Redaktə edilir:", editingStudentId);

      await db.collection("students").doc(editingStudentId).update({
        fullName: studentName,
        grade: studentClass,
        phone: studentPhone,
        parentName: parentName,
        parentPhone: parentPhone,
        updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
      });

      // users kolleksiyasını da yenilə
      await db.collection("users").doc(studentEmail).update({
        fullName: studentName,
        phone: studentPhone,
        updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
      });

      if (parentEmail) {
        await db.collection("users").doc(parentEmail).update({
          fullName: parentName,
          phone: parentPhone,
          updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
        });
      }

      alert("✅ Məlumatlar uğurla yeniləndi!");
      closeModal();
      loadStudents();
    } else {
      // ========== YENİ ŞAGİRD YARATMA ==========
      console.log("🆕 Yeni şagird yaradılır");

      if (!password || password.length < 6) {
        alert("⚠️ Şifrə minimum 6 simvol olmalıdır!");
        return;
      }
      if (!parentEmail) {
        alert("⚠️ Valideyn email-i doldurulmalıdır!");
        return;
      }

      console.log("☁️ Cloud Function çağırılır...");

      // ✅ MANUAL FETCH - Direct URL
      const idToken = await auth.currentUser.getIdToken();

      const response = await fetch(
        "https://europe-west1-bekrinschool.cloudfunctions.net/createSingleStudent",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${idToken}`,
          },
          body: JSON.stringify({
            data: {
              studentEmail: studentEmail,
              parentEmail: parentEmail,
              password: password,
              fullName: studentName,
              grade: studentClass,
              studentPhone: studentPhone,
              parentName: parentName,
              parentPhone: parentPhone,
            },
          }),
        }
      );

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`HTTP ${response.status}: ${errorText}`);
      }

      const result = await response.json();
      console.log("✅ Cloud Function cavabı:", result);

      const resultData = result.result || result;

      let message = "✅ Şagird və valideyn uğurla yaradıldı!\n\n";
      message += "📋 Yaradılan hesablar:\n";
      resultData.results.success.forEach((s) => {
        message += `${s}\n`;
      });
      message += "\n🔐 Login məlumatları:\n";
      message += `Şagird Email: ${studentEmail}\n`;
      message += `Valideyn Email: ${parentEmail}\n`;
      message += `Şifrə: ${password}`;

      alert(message);
      closeModal();
      loadStudents();
    }
  } catch (error) {
    console.error("❌ Xəta:", error);
    alert(`❌ Xəta: ${error.message}`);
  }
}

// Şagirdi sil (soft delete + qruplardan çıxart)
async function deleteStudent(studentId) {
  if (!confirm("Bu şagirdi silmək istədiyinizə əminsiniz?")) return;

  try {
    console.log("🗑️ Şagird silinir:", studentId);

    // 1) Soft delete - statusu "deleted" et
    await db.collection("students").doc(studentId).update({
      status: "deleted",
      deletedAt: firebase.firestore.FieldValue.serverTimestamp(),
    });

    // 2) ✅ Qruplardan da çıxart
    const groupsSnapshot = await db
      .collection("groups")
      .where("students", "array-contains", studentId)
      .get();

    if (!groupsSnapshot.empty) {
      console.log(`📋 ${groupsSnapshot.size} qrupdan çıxarılır...`);

      const batch = db.batch();

      groupsSnapshot.forEach((doc) => {
        const groupRef = db.collection("groups").doc(doc.id);
        batch.update(groupRef, {
          students: firebase.firestore.FieldValue.arrayRemove(studentId),
        });
      });

      await batch.commit();
      console.log("✅ Qruplardan çıxarıldı!");
    }

    alert("✅ Şagird silindi və qruplardan çıxarıldı!");
    loadStudents();
  } catch (error) {
    console.error("❌ Xəta:", error);
    alert("❌ Xəta: " + error.message);
  }
}

// Şagirdi geri qaytar
async function restoreStudent(studentId) {
  if (!confirm("Bu şagirdi geri qaytarmaq istədiyinizə əminsiniz?")) return;

  try {
    await db.collection("students").doc(studentId).update({
      status: "active",
      restoredAt: firebase.firestore.FieldValue.serverTimestamp(),
    });

    alert("✅ Şagird geri qaytarıldı!");
    loadStudents();
  } catch (error) {
    console.error("Xəta:", error);
    alert("❌ Xəta: " + error.message);
  }
}
