const auth = firebase.auth();
const db = firebase.firestore();

// Auth State
auth.onAuthStateChanged(async (user) => {
  if (!user) {
    window.location.href = "index.html";
    return;
  }

  try {
    const userDoc = await db.collection("users").doc(user.email).get();
    if (!userDoc.exists || userDoc.data().role !== "parent") {
      alert("Bu səhifəyə yalnız valideynlər daxil ola bilər!");
      await auth.signOut();
      window.location.href = "index.html";
      return;
    }

    console.log("✅ Valideyn:", user.email);

    await loadChildren(user.email);

    if (typeof window.initNotifications === "function") {
      window.initNotifications(user.email);
    }
  } catch (error) {
    console.error("Auth xətası:", error);
    alert("Giriş yoxlanılarkən xəta baş verdi");
  }
});

// Load Children
async function loadChildren(parentEmail) {
  try {
    console.log("📚 Şagirdlər yüklənir...");

    const studentsSnapshot = await db
      .collection("students")
      .where("parentEmail", "==", parentEmail)
      .where("status", "==", "active")
      .get();

    const childrenCount = studentsSnapshot.size;
    console.log(`👨‍👩‍👧‍👦 ${childrenCount} şagird tapıldı`);

    if (childrenCount === 0) {
      document.getElementById("loadingDiv").style.display = "none";
      document.getElementById("noChildrenDiv").style.display = "block";
      return;
    }

    const exercisesSnapshot = await db.collection("codingExercises").get();
    const totalExercises = exercisesSnapshot.size;
    console.log(`💻 Ümumi tapşırıqlar: ${totalExercises}`);

    const childrenData = [];

    for (const studentDoc of studentsSnapshot.docs) {
      const student = studentDoc.data();
      const studentEmail = student.email;

      console.log(`📊 Yüklənir: ${student.fullName}`);

      const progressSnapshot = await db
        .collection("studentCodingProgress")
        .doc(studentEmail)
        .get();

      let codingRate = 0;
      if (progressSnapshot.exists) {
        const completedExercises =
          progressSnapshot.data().completedExercises || [];
        codingRate =
          totalExercises > 0
            ? Math.round((completedExercises.length / totalExercises) * 100)
            : 0;
      }

      const attendanceRate = await calculateAttendanceRate(studentEmail);

      childrenData.push({
        fullName: student.fullName || "Ad Soyad",
        class: student.grade || "Sinif",
        email: studentEmail,
        avatar: (student.fullName || "A")[0].toUpperCase(),
        stats: {
          attendance: attendanceRate,
          balance: student.balance || 0,
          lastTest: student.lastTest || "N/A",
          codingRate: codingRate,
        },
      });
    }

    displayChildren(childrenData);
  } catch (error) {
    console.error("Yüklənərkən xəta:", error);
    document.getElementById("loadingDiv").innerHTML =
      '<div style="color: #ff4757; background: white; padding: 30px; border-radius: 15px;">❌ Xəta baş verdi: ' +
      error.message +
      "</div>";
  }
}

// Calculate Attendance Rate
async function calculateAttendanceRate(studentEmail) {
  try {
    const groupsSnapshot = await db
      .collection("groups")
      .where("students", "array-contains", studentEmail)
      .where("active", "==", true)
      .get();

    let totalRecords = 0;
    let attended = 0;

    for (const groupDoc of groupsSnapshot.docs) {
      const groupId = groupDoc.id;
      const attendanceDoc = await db
        .collection("attendance")
        .doc(groupId)
        .get();

      if (attendanceDoc.exists) {
        const attendanceData = attendanceDoc.data();
        const months = attendanceData.months || [];

        // ✅ DÜZƏLİŞ: ROOT-dan data oxu
        const data = attendanceData.data || {};
        const studentData = data[studentEmail] || {};

        // Process each month
        months.forEach((month, monthIndex) => {
          month.columns.forEach((column, columnIndex) => {
            const key = `${monthIndex}_${columnIndex}`;
            const status = studentData[key];

            if (status) {
              totalRecords++;
              if (["present", "late", "excused"].includes(status)) {
                attended++;
              }
            }
          });
        });
      }
    }

    return totalRecords > 0 ? Math.round((attended / totalRecords) * 100) : 0;
  } catch (error) {
    console.error("Davamiyyət hesablanarkən xəta:", error);
    return 0;
  }
}

// Display Children
function displayChildren(children) {
  document.getElementById("loadingDiv").style.display = "none";
  const grid = document.getElementById("childrenGrid");

  grid.innerHTML = children
    .map(
      (child) => `
        <div class="child-card">
            <div class="child-header">
                <div class="child-avatar">${child.avatar}</div>
                <div class="child-info">
                    <h3>${child.fullName}</h3>
                    <p>🎓 ${child.class}</p>
                </div>
            </div>
            
            <div class="stats-grid">
                <div class="stat-box">
                    <div class="label">📅 Davamiyyət</div>
                    <div class="value">${child.stats.attendance}%</div>
                </div>
                <div class="stat-box">
                    <div class="label">💰 Balans</div>
                    <div class="value">${child.stats.balance}₼</div>
                </div>
                <div class="stat-box">
                    <div class="label">📝 Son Test</div>
                    <div class="value">${child.stats.lastTest}</div>
                </div>
                <div class="stat-box">
                    <div class="label">💻 Proqramlaşdırma</div>
                    <div class="value">${child.stats.codingRate}%</div>
                </div>
            </div>
            
            <div class="actions">
                <button class="action-btn btn-attendance" onclick="viewAttendance('${child.email}')">
                    📅 Davamiyyət
                </button>
                <button class="action-btn btn-payments" onclick="viewPayments('${child.email}', '${child.fullName}')">
                    💰 Ödənişlər
                </button>
                <button class="action-btn btn-tests" onclick="viewTests('${child.email}')">
                    📝 Testlər
                </button>
            </div>
        </div>
    `
    )
    .join("");
}

// View Attendance
window.viewAttendance = function (studentEmail) {
  window.location.href = `parent-student-attendance.html?student=${encodeURIComponent(
    studentEmail
  )}`;
};

// View Payments
window.viewPayments = async function (studentEmail, studentName) {
  const modal = document.getElementById("paymentsModal");
  const content = document.getElementById("paymentsContent");

  modal.classList.add("show");
  content.innerHTML =
    '<div style="text-align: center; padding: 40px;"><i class="fas fa-spinner fa-spin"></i> ⏳ Ödənişlər yüklənir...</div>';

  try {
    const paymentsSnapshot = await db
      .collection("payments")
      .where("studentEmail", "==", studentEmail)
      .get();

    console.log("💰 Ödənişlər:", paymentsSnapshot.size);

    if (paymentsSnapshot.empty) {
      content.innerHTML = `
                <div class="no-payments">
                    <i class="fas fa-wallet" style="font-size: 64px; color: #ddd; margin-bottom: 20px;"></i>
                    <h3>Hələ ödəniş edilməyib</h3>
                    <p>Bu şagird üçün hələ ödəniş qeydə alınmayıb</p>
                </div>
            `;
      return;
    }

    let totalPaid = 0;
    const payments = [];

    // Helper function: dd.mm.yyyy → timestamp
    const parseDate = (dateStr) => {
      if (!dateStr) return 0;
      const [day, month, year] = dateStr.split(".");
      return new Date(`${year}-${month}-${day}`).getTime();
    };

    paymentsSnapshot.forEach((doc) => {
      const payment = doc.data();
      totalPaid += payment.amount || 0;
      payments.push(payment);
    });

    // Sırala (ən yeni əvvəl)
    payments.sort((a, b) => parseDate(b.date) - parseDate(a.date));

    // Son ödəniş = ən yeni (ilk element)
    const lastDateStr =
      payments.length > 0 && payments[0].date ? payments[0].date : "N/A";

    content.innerHTML = `
            <div class="payment-summary">
                <div class="summary-box">
                    <div class="label">Ümumi Ödəniş</div>
                    <div class="value">${totalPaid}₼</div>
                </div>
                <div class="summary-box">
                    <div class="label">Son Ödəniş</div>
                    <div class="value" style="font-size: 18px;">${lastDateStr}</div>
                </div>
            </div>

            <table class="payments-table">
                <thead>
                    <tr>
                        <th>Tarix</th>
                        <th>Məbləğ</th>
                        <th>№</th>
                        <th>Üsul</th>
                        <th>Qeyd</th>
                    </tr>
                </thead>
                <tbody>
                    ${payments
                      .map((p) => {
                        const dateStr = p.date || "N/A";

                        return `
                        <tr>
                            <td>${dateStr}</td>
                            <td><strong>${p.amount || 0}₼</strong></td>
                            <td>${p.paymentNumber || "-"}</td>
                            <td>
                                <span class="payment-method method-${
                                  p.method || "cash"
                                }">
                                    ${
                                      p.method === "card"
                                        ? "💳 Kart"
                                        : "💵 Nağd"
                                    }
                                </span>
                            </td>
                            <td>${p.note || "-"}</td>
                        </tr>
                    `;
                      })
                      .join("")}
                </tbody>
            </table>
        `;
  } catch (error) {
    console.error("Ödənişlər yüklənərkən xəta:", error);
    content.innerHTML = `<div class="no-payments">❌ Xəta: ${error.message}</div>`;
  }
};

window.closePaymentsModal = function () {
  document.getElementById("paymentsModal").classList.remove("show");
};

// View Tests
window.viewTests = function (studentEmail) {
  alert(`Test nəticələri: ${studentEmail}\n(Tezliklə əlavə olunacaq)`);
};

// Logout
window.logout = async function () {
  if (confirm("Çıxış etmək istədiyinizə əminsiniz?")) {
    try {
      await auth.signOut();
      window.location.href = "index.html";
    } catch (error) {
      console.error("Çıxış xətası:", error);
      alert("Çıxış zamanı xəta baş verdi");
    }
  }
};
