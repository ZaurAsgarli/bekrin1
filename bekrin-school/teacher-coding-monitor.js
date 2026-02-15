// ============================================
// FIREBASE CONFIGURATION
// ============================================

const firebaseConfig = {
  apiKey: "AIzaSyDE05ufg0FhPIAecIJ_ehr9yIFQKxIwncA",
  authDomain: "bekrinschool.firebaseapp.com",
  projectId: "bekrinschool",
  storageBucket: "bekrinschool.firebasestorage.app",
  messagingSenderId: "678081137706",
  appId: "1:678081137706:web:75601b998dde21f25f0753",
};

firebase.initializeApp(firebaseConfig);
const auth = firebase.auth();
const db = firebase.firestore();

// ============================================
// GLOBAL VARIABLES
// ============================================

let currentTeacher = null;
let selectedStudent = null;
let allStudentStats = [];

// ============================================
// AUTHENTICATION CHECK
// ============================================

auth.onAuthStateChanged(async (user) => {
  if (!user) {
    window.location.href = "index.html";
    return;
  }

  try {
    const userDoc = await db.collection("users").doc(user.email).get();
    if (!userDoc.exists || userDoc.data().role !== "teacher") {
      alert("Bu səhifəyə yalnız müəllimlər daxil ola bilər!");
      await auth.signOut();
      window.location.href = "index.html";
      return;
    }

    currentTeacher = user;
    console.log("✅ Müəllim: " + user.email);
    loadStudentRankings();
  } catch (error) {
    console.error("Auth xətası:", error);
    alert("Yüklənərkən xəta: " + error.message);
  }
});

// ============================================
// LOAD STUDENT RANKINGS
// ============================================

async function loadStudentRankings() {
  try {
    console.log("📊 Şagird reytinqi yüklənir...");

    // Müəllimin şagirdlərini al
    const studentsSnapshot = await db
      .collection("students")
      .where("createdBy", "==", currentTeacher.email)
      .where("status", "==", "active")
      .get();

    console.log("👥 Tapılan şagird sayı:", studentsSnapshot.size);

    if (studentsSnapshot.size === 0) {
      document.getElementById("studentList").innerHTML = `
        <div class="empty-state">
          <div class="icon">📚</div>
          <p>Hələ şagird yoxdur</p>
          <small style="color: #999;">Şagird əlavə etmək üçün "Şagirdlər" bölməsinə keçin</small>
        </div>
      `;
      return;
    }

    // ✅ Toplam tapşırıq sayını əldə et
    const exercisesSnapshot = await db.collection("codingExercises").get();
    const totalExercises = exercisesSnapshot.size;
    console.log("📚 Toplam tapşırıq sayı:", totalExercises);

    // Hər şagirdin statistikasını al
    allStudentStats = [];

    for (let i = 0; i < studentsSnapshot.docs.length; i++) {
      const studentDoc = studentsSnapshot.docs[i];
      const studentData = studentDoc.data();
      const email = studentData.email;

      console.log(
        `📊 ${i + 1}/${
          studentsSnapshot.size
        } - ${email} statistikası yoxlanılır...`
      );

      try {
        // ✅ studentCodingProgress-dən oxu
        const progressDoc = await db
          .collection("studentCodingProgress")
          .doc(email)
          .get();

        if (progressDoc.exists) {
          const progressData = progressDoc.data();

          // ✅ completedExercises array-nin uzunluğu
          const completedExercises = progressData.completedExercises
            ? progressData.completedExercises.length
            : 0;

          // ✅ totalPoints
          const totalPoints = progressData.totalPoints || 0;

          // ✅ Faiz hesabla
          const successRate =
            totalExercises > 0
              ? Math.round((completedExercises / totalExercises) * 100)
              : 0;

          // ✅ Ortalama xal
          const averageScore =
            completedExercises > 0
              ? Math.round(totalPoints / completedExercises)
              : 0;

          allStudentStats.push({
            email: email,
            studentName: studentData.fullName || email,
            successRate: successRate,
            completedExercises: completedExercises,
            totalExercises: totalExercises,
            totalPoints: totalPoints,
            averageScore: averageScore,
          });

          console.log(
            `✅ ${email}: ${successRate}% (${completedExercises}/${totalExercises})`
          );
        } else {
          // Heç tapşırıq həll etməyib
          allStudentStats.push({
            email: email,
            studentName: studentData.fullName || email,
            successRate: 0,
            completedExercises: 0,
            totalExercises: totalExercises,
            totalPoints: 0,
            averageScore: 0,
          });

          console.log(`⚪ ${email}: 0% (heç tapşırıq həll etməyib)`);
        }
      } catch (error) {
        console.error(`❌ ${email} statistikası xəta:`, error);

        // Xətada belə, şagirdi siyahıya əlavə et
        allStudentStats.push({
          email: email,
          studentName: studentData.fullName || email,
          successRate: 0,
          completedExercises: 0,
          totalExercises: totalExercises,
          totalPoints: 0,
          averageScore: 0,
        });
      }
    }

    console.log("📊 Yüklənən statistikalar:", allStudentStats);

    if (allStudentStats.length === 0) {
      document.getElementById("studentList").innerHTML = `
        <div class="empty-state">
          <div class="icon">⚠️</div>
          <p>Şagirdlər tapıldı, amma statistika yoxdur</p>
          <small style="color: #999;">Şagirdlər hələ kodlaşdırma məşqləri həll etməyib</small>
        </div>
      `;
      return;
    }

    // ✅ Azalma sırası (ən yüksək faiz birinci)
    allStudentStats.sort((a, b) => (b.successRate || 0) - (a.successRate || 0));

    displayStudentRankings();

    console.log("✅ Şagird reytinqi uğurla yükləndi");
  } catch (error) {
    console.error("❌ Reyting yüklənərkən xəta:", error);
    console.error("Xəta detalları:", error.message);
    console.error("Xəta stack:", error.stack);

    document.getElementById("studentList").innerHTML = `
      <div class="empty-state">
        <div class="icon" style="color: red;">❌</div>
        <p style="color: red;">Xəta baş verdi!</p>
        <small style="color: #666;">${error.message}</small>
        <br><br>
        <button onclick="loadStudentRankings()" style="
          padding: 10px 20px;
          background: #667eea;
          color: white;
          border: none;
          border-radius: 5px;
          cursor: pointer;
        ">Yenidən Cəhd Et</button>
      </div>
    `;
  }
}

// ============================================
// DISPLAY STUDENT RANKINGS
// ============================================

function displayStudentRankings() {
  const listHtml = allStudentStats
    .map((student, index) => {
      const rate = student.successRate || 0;
      let rateClass = "rate-low";
      let rateIcon = "❌";

      if (rate >= 70) {
        rateClass = "rate-high";
        rateIcon = "✅";
      } else if (rate >= 50) {
        rateClass = "rate-medium";
        rateIcon = "⚠️";
      }

      return `
        <div class="student-item" onclick="selectStudent('${student.email}')">
          <div>
            <span class="student-rank">${index + 1}</span>
            <span class="student-name">${student.studentName}</span>
          </div>
          <div class="student-stats">
            <span class="success-rate ${rateClass}">
              ${rateIcon} ${rate.toFixed(0)}%
            </span>
            <span>${student.completedExercises || 0}/${
        student.totalExercises || 0
      } tapşırıq</span>
          </div>
        </div>
      `;
    })
    .join("");

  document.getElementById("studentList").innerHTML = listHtml;
}

// ============================================
// SELECT STUDENT
// ============================================

async function selectStudent(studentEmail) {
  selectedStudent = allStudentStats.find((s) => s.email === studentEmail);

  // Active class
  document.querySelectorAll(".student-item").forEach((item) => {
    item.classList.remove("active");
  });
  event.currentTarget.classList.add("active");

  // Şagird detaylarını yüklə
  await loadStudentDetails(studentEmail);
}

// ============================================
// LOAD STUDENT DETAILS
// ============================================

async function loadStudentDetails(studentEmail) {
  try {
    document.getElementById("mainContentArea").innerHTML = `
      <div class="loading">
        <i class="fas fa-spinner fa-spin fa-2x"></i>
        <p>Yüklənir...</p>
      </div>
    `;

    // ✅ studentCodingProgress-dən submissions al
    const progressDoc = await db
      .collection("studentCodingProgress")
      .doc(studentEmail)
      .get();

    let exercises = [];

    if (progressDoc.exists) {
      const progressData = progressDoc.data();
      const submissions = progressData.submissions || {};

      // ✅ Submissions-u array-ə çevir və tariхə görə sırala
      exercises = Object.entries(submissions)
        .map(([exerciseId, data]) => ({
          id: exerciseId,
          exerciseId: exerciseId,
          exerciseName: data.exerciseName || exerciseId,
          code: data.code || "",
          result: data.result || "",
          status: data.status || "pending",
          score: data.score || 0,
          attempts: data.attempts || 1,
          completedAt: data.submittedAt || data.completedAt || null,
          lastAttemptAt: data.submittedAt || data.lastAttemptAt || null,
        }))
        .sort((a, b) => {
          // Tarixə görə azalan sıra (ən yeni birinci)
          const timeA = a.lastAttemptAt?.seconds || 0;
          const timeB = b.lastAttemptAt?.seconds || 0;
          return timeB - timeA;
        });
    }

    console.log(`📝 ${studentEmail} üçün ${exercises.length} məşq tapıldı`);

    displayStudentDetails(exercises);
  } catch (error) {
    console.error("Error loading student details:", error);
    document.getElementById("mainContentArea").innerHTML = `
      <div class="empty-state">
        <div class="icon" style="color: red;">❌</div>
        <p style="color: red;">Xəta baş verdi!</p>
        <small style="color: #666;">${error.message}</small>
      </div>
    `;
  }
}

// ============================================
// DISPLAY STUDENT DETAILS
// ============================================

function displayStudentDetails(exercises) {
  const student = selectedStudent;

  let html = `
    <div class="content-header">
      <h2>
        <i class="fas fa-user-graduate"></i>
        ${student.studentName}
      </h2>
      <div class="student-info-bar">
        <div class="info-card">
          <div class="info-label">Uğur Faizi</div>
          <div class="info-value">${(student.successRate || 0).toFixed(
            0
          )}%</div>
        </div>
        <div class="info-card">
          <div class="info-label">Tamamlanmış</div>
          <div class="info-value">${student.completedExercises || 0}</div>
        </div>
        <div class="info-card">
          <div class="info-label">Cəmi Tapşırıq</div>
          <div class="info-value">${student.totalExercises || 0}</div>
        </div>
        <div class="info-card">
          <div class="info-label">Toplam Xal</div>
          <div class="info-value">${student.totalPoints || 0}</div>
        </div>
        <div class="info-card">
          <div class="info-label">Orta Bal</div>
          <div class="info-value">${(student.averageScore || 0).toFixed(
            0
          )}</div>
        </div>
      </div>
    </div>
  `;

  if (exercises.length === 0) {
    html += `
      <div class="empty-state">
        <div class="icon">📝</div>
        <h3>Hələ tapşırıq həll etməyib</h3>
        <p style="color: #999;">Bu şagird hələ heç bir kodlaşdırma tapşırığı həll etməyib</p>
      </div>
    `;
  } else {
    html += '<div class="exercise-list">';
    exercises.forEach((ex) => {
      const statusClass =
        ex.status === "solved" || ex.status === "completed"
          ? "completed"
          : "failed";
      const statusIcon =
        ex.status === "solved" || ex.status === "completed" ? "✅" : "❌";

      html += `
        <div class="exercise-card ${statusClass}" onclick="viewExerciseCode('${
        ex.id
      }')">
          <div class="exercise-title">
            ${statusIcon} ${ex.exerciseName || ex.exerciseId}
          </div>
          <div class="exercise-meta">
            <span>📊 Bal: ${ex.score || 0}</span>
            <span>🔄 Cəhd: ${ex.attempts || 1}</span>
          </div>
          <div class="exercise-meta">
            <span style="font-size: 12px; color: #999;">
              ${
                ex.completedAt
                  ? new Date(ex.completedAt.seconds * 1000).toLocaleString(
                      "az-AZ"
                    )
                  : ex.lastAttemptAt
                  ? new Date(ex.lastAttemptAt.seconds * 1000).toLocaleString(
                      "az-AZ"
                    )
                  : "N/A"
              }
            </span>
          </div>
        </div>
      `;
    });
    html += "</div>";
  }

  document.getElementById("mainContentArea").innerHTML = html;
}

// ============================================
// VIEW EXERCISE CODE
// ============================================

async function viewExerciseCode(exerciseId) {
  try {
    // ✅ studentCodingProgress-dən submissions içindən oxu
    const progressDoc = await db
      .collection("studentCodingProgress")
      .doc(selectedStudent.email)
      .get();

    if (!progressDoc.exists) {
      alert("Şagirdin progress məlumatı tapılmadı!");
      return;
    }

    const progressData = progressDoc.data();
    const submissions = progressData.submissions || {};
    const exercise = submissions[exerciseId];

    if (!exercise) {
      alert("Bu tapşırıq üçün submission tapılmadı!");
      return;
    }

    let modalHtml = `
      <h4>${exercise.exerciseName || exerciseId}</h4>
      <p><strong>Şagird:</strong> ${selectedStudent.studentName}</p>
      
      <h5 style="margin-top: 30px;">📝 Yazılmış Kod:</h5>
      <pre><code class="language-python">${escapeHtml(
        exercise.code || "Kod yoxdur"
      )}</code></pre>
      
      <h5>📊 Nəticə:</h5>
      <div class="result-box ${
        exercise.status === "solved" || exercise.status === "completed"
          ? "success"
          : "error"
      }">
        <strong>Status:</strong> ${
          exercise.status === "solved" || exercise.status === "completed"
            ? "✅ Uğurlu"
            : "❌ Uğursuz"
        }<br>
        <strong>Bal:</strong> ${exercise.score || 0}<br>
        ${
          exercise.result
            ? `<strong>Çıxış:</strong><br><pre>${escapeHtml(
                exercise.result
              )}</pre>`
            : ""
        }
      </div>
      
      <div style="display: flex; gap: 20px; margin-top: 20px;">
        <div>
          <strong>Cəhd sayı:</strong> ${exercise.attempts || 1}
        </div>
        <div>
          <strong>Tamamlanma tarixi:</strong> 
          ${
            exercise.submittedAt
              ? new Date(exercise.submittedAt.seconds * 1000).toLocaleString(
                  "az-AZ"
                )
              : exercise.completedAt
              ? new Date(exercise.completedAt.seconds * 1000).toLocaleString(
                  "az-AZ"
                )
              : "N/A"
          }
        </div>
      </div>
    `;

    document.getElementById("modalTitle").textContent =
      exercise.exerciseName || exerciseId;
    document.getElementById("modalBody").innerHTML = modalHtml;
    document.getElementById("codeModal").classList.add("active");

    // Syntax highlighting
    if (typeof Prism !== "undefined") {
      Prism.highlightAll();
    }
  } catch (error) {
    console.error("Error viewing code:", error);
    alert("Xəta baş verdi: " + error.message);
  }
}

// ============================================
// CLOSE CODE MODAL
// ============================================

function closeCodeModal() {
  document.getElementById("codeModal").classList.remove("active");
}

// ============================================
// HTML ESCAPE
// ============================================

function escapeHtml(text) {
  const map = {
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#039;",
  };
  return text.replace(/[&<>"']/g, (m) => map[m]);
}
