const functions = require("firebase-functions");
const admin = require("firebase-admin");

admin.initializeApp();

// ============================================
// 1️⃣ BULK İSTİFADƏÇİ YARATMA
// ============================================
exports.bulkCreateUsers = functions
  .region("europe-west1")
  .runWith({
    timeoutSeconds: 540,
    memory: "1GB",
  })
  .https.onCall(async (data, context) => {
    // Auth yoxlaması
    if (!context.auth) {
      throw new functions.https.HttpsError(
        "unauthenticated",
        "Sistemə daxil olmamısınız!"
      );
    }

    const callerEmail = context.auth.token.email;
    const callerDoc = await admin
      .firestore()
      .collection("users")
      .doc(callerEmail)
      .get();

    if (
      !callerDoc.exists ||
      !["teacher", "admin"].includes(callerDoc.data().role)
    ) {
      throw new functions.https.HttpsError(
        "permission-denied",
        "Yalnız müəllimlər istifadə edə bilər!"
      );
    }

    // Data validasiya
    const users = data.users;
    if (!Array.isArray(users) || users.length === 0) {
      throw new functions.https.HttpsError(
        "invalid-argument",
        "İstifadəçi siyahısı boşdur!"
      );
    }

    if (users.length > 500) {
      throw new functions.https.HttpsError(
        "invalid-argument",
        "Maksimum 500 istifadəçi əlavə edə bilərsiniz!"
      );
    }

    // Hər user validasiya
    for (let i = 0; i < users.length; i++) {
      const user = users[i];

      if (
        !user.fullName ||
        !user.grade ||
        !user.studentEmail ||
        !user.parentEmail ||
        !user.password
      ) {
        throw new functions.https.HttpsError(
          "invalid-argument",
          `User ${i + 1}: Bütün sahələr doldurulmalıdır!`
        );
      }

      if (user.password.length < 6) {
        throw new functions.https.HttpsError(
          "invalid-argument",
          `User ${i + 1}: Şifrə minimum 6 simvol olmalıdır`
        );
      }

      // Email formatı yoxla və təmizlə
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      user.studentEmail = user.studentEmail
        .trim()
        .replace(/\s+/g, "")
        .toLowerCase();
      user.parentEmail = user.parentEmail
        .trim()
        .replace(/\s+/g, "")
        .toLowerCase();

      if (!emailRegex.test(user.studentEmail)) {
        throw new functions.https.HttpsError(
          "invalid-argument",
          `User ${i + 1}: Şagird email düzgün deyil: ${user.studentEmail}`
        );
      }

      if (!emailRegex.test(user.parentEmail)) {
        throw new functions.https.HttpsError(
          "invalid-argument",
          `User ${i + 1}: Valideyn email düzgün deyil: ${user.parentEmail}`
        );
      }
    }

    const results = {
      success: [],
      errors: [],
      total: 0,
    };

    // Hər istifadəçi üçün 2 hesab yarat
    for (const user of users) {
      const { fullName, grade, studentEmail, parentEmail, password } = user;

      try {
        // 1️⃣ Şagird Authentication hesabı
        try {
          await admin.auth().createUser({
            email: studentEmail,
            password: password,
            displayName: fullName,
          });
          results.success.push({
            email: studentEmail,
            role: "student",
            name: fullName,
            message: "✅ Yaradıldı",
          });
        } catch (authError) {
          if (authError.code === "auth/email-already-exists") {
            results.success.push({
              email: studentEmail,
              role: "student",
              name: fullName,
              message: "ℹ️ Auth artıq mövcuddur",
            });
          } else {
            throw authError;
          }
        }

        // 2️⃣ Valideyn Authentication hesabı
        try {
          await admin.auth().createUser({
            email: parentEmail,
            password: password,
            displayName: `${fullName} - Valideyn`,
          });
          results.success.push({
            email: parentEmail,
            role: "parent",
            name: `${fullName} - Valideyn`,
            message: "✅ Yaradıldı",
          });
        } catch (authError) {
          if (authError.code === "auth/email-already-exists") {
            results.success.push({
              email: parentEmail,
              role: "parent",
              name: `${fullName} - Valideyn`,
              message: "ℹ️ Auth artıq mövcuddur",
            });
          } else {
            throw authError;
          }
        }

        // 3️⃣ Firestore: students kolleksiyası (✅ ƏSAS DÜZƏLİŞ)
        await admin.firestore().collection("students").doc(studentEmail).set(
          {
            email: studentEmail,
            fullName: fullName,
            grade: grade,
            class: grade, // ✅ class sahəsi də əlavə et (uyğunluq üçün)
            phone: "",
            parentName: "",
            parentEmail: parentEmail,
            parentPhone: "",
            balance: 0,
            status: "active",
            createdAt: admin.firestore.FieldValue.serverTimestamp(),
            createdBy: callerEmail, // ✅ Bu müəllim email-i olmalıdır
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
          },
          { merge: true }
        ); // ✅ merge: true - mövcud data saxla

        // 4️⃣ Firestore: users (şagird)
        await admin.firestore().collection("users").doc(studentEmail).set(
          {
            email: studentEmail,
            fullName: fullName,
            role: "student",
            grade: grade,
            phone: "",
            parentEmail: parentEmail,
            parentName: "",
            parentPhone: "",
            createdAt: admin.firestore.FieldValue.serverTimestamp(),
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
          },
          { merge: true }
        );

        // 5️⃣ Firestore: users (valideyn)
        await admin.firestore().collection("users").doc(parentEmail).set(
          {
            email: parentEmail,
            fullName: "",
            role: "parent",
            phone: "",
            studentEmail: studentEmail,
            createdAt: admin.firestore.FieldValue.serverTimestamp(),
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
          },
          { merge: true }
        );

        results.total += 2;
      } catch (error) {
        console.error(`Error processing ${studentEmail}:`, error);
        results.errors.push({
          email: studentEmail,
          name: fullName,
          error: error.message,
        });
      }
    }

    // Log yaz
    await admin
      .firestore()
      .collection("bulkImportLogs")
      .add({
        callerEmail: callerEmail,
        timestamp: admin.firestore.FieldValue.serverTimestamp(),
        totalUsers: users.length,
        totalAccounts: users.length * 2,
        successCount: results.success.length,
        errorCount: results.errors.length,
        results: results,
      });

    return {
      message: `${results.success.length}/${users.length * 2} hesab yaradıldı`,
      results: results,
    };
  });

// ============================================
// 2️⃣ TƏK ŞAGİRD YARATMA
// ============================================
exports.createSingleStudent = functions
  .region("europe-west1")
  .runWith({
    timeoutSeconds: 60,
    memory: "512MB",
  })
  .https.onCall(async (data, context) => {
    // Auth yoxlaması
    if (!context.auth) {
      throw new functions.https.HttpsError(
        "unauthenticated",
        "Sistemə daxil olmamısınız!"
      );
    }

    const callerEmail = context.auth.token.email;
    const callerDoc = await admin
      .firestore()
      .collection("users")
      .doc(callerEmail)
      .get();

    if (
      !callerDoc.exists ||
      !["teacher", "admin"].includes(callerDoc.data().role)
    ) {
      throw new functions.https.HttpsError(
        "permission-denied",
        "Yalnız müəllimlər istifadə edə bilər!"
      );
    }

    const {
      studentEmail,
      parentEmail,
      password,
      fullName,
      grade,
      studentPhone,
      parentName,
      parentPhone,
    } = data;

    // Validasiya
    if (!studentEmail || !parentEmail || !password || !fullName) {
      throw new functions.https.HttpsError(
        "invalid-argument",
        "Zəruri sahələr doldurulmalıdır!"
      );
    }

    if (password.length < 6) {
      throw new functions.https.HttpsError(
        "invalid-argument",
        "Şifrə minimum 6 simvol olmalıdır!"
      );
    }

    const results = {
      success: [],
      errors: [],
    };

    try {
      // 1️⃣ Şagird Authentication hesabı yarat
      try {
        await admin.auth().createUser({
          email: studentEmail,
          password: password,
          displayName: fullName,
        });
        results.success.push(`✅ Şagird Auth: ${studentEmail}`);
      } catch (error) {
        if (error.code === "auth/email-already-exists") {
          results.success.push(
            `ℹ️ Şagird Auth artıq mövcuddur: ${studentEmail}`
          );
        } else {
          throw error;
        }
      }

      // 2️⃣ Valideyn Authentication hesabı yarat
      try {
        await admin.auth().createUser({
          email: parentEmail,
          password: password,
          displayName: `${fullName} - Valideyn`,
        });
        results.success.push(`✅ Valideyn Auth: ${parentEmail}`);
      } catch (error) {
        if (error.code === "auth/email-already-exists") {
          results.success.push(
            `ℹ️ Valideyn Auth artıq mövcuddur: ${parentEmail}`
          );
        } else {
          throw error;
        }
      }

      // 3️⃣ Firestore: students kolleksiyası
      await admin
        .firestore()
        .collection("students")
        .doc(studentEmail)
        .set({
          email: studentEmail,
          fullName: fullName,
          grade: grade || "",
          class: grade || "",
          phone: studentPhone || "",
          parentName: parentName || "",
          parentEmail: parentEmail,
          parentPhone: parentPhone || "",
          balance: 0,
          status: "active",
          createdAt: admin.firestore.FieldValue.serverTimestamp(),
          createdBy: callerEmail,
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        });
      results.success.push(`✅ Firestore students/${studentEmail}`);

      // 4️⃣ Firestore: users (şagird)
      await admin
        .firestore()
        .collection("users")
        .doc(studentEmail)
        .set({
          email: studentEmail,
          fullName: fullName,
          role: "student",
          grade: grade || "",
          phone: studentPhone || "",
          parentEmail: parentEmail,
          createdAt: admin.firestore.FieldValue.serverTimestamp(),
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        });
      results.success.push(`✅ Firestore users/${studentEmail}`);

      // ============================================
      // 4️⃣A STATİSTİKA AVTOMATİK YENİLƏNMƏSİ
      // ============================================

      // Şagird yeni məşq tamamladıqda statistikanı yenilə
      exports.updateCodingStats = functions
        .region("europe-west1")
        .firestore.document(
          "studentCodingProgress/{studentEmail}/exercises/{exerciseId}"
        )
        .onWrite(async (change, context) => {
          const studentEmail = context.params.studentEmail;

          try {
            console.log(`📊 ${studentEmail} üçün statistika yenilənir...`);

            // Şagirdin bütün məşqlərini al
            const exercisesSnapshot = await admin
              .firestore()
              .collection("studentCodingProgress")
              .doc(studentEmail)
              .collection("exercises")
              .get();

            if (exercisesSnapshot.empty) {
              console.log(`⚠️ ${studentEmail} üçün heç bir məşq tapılmadı`);
              return null;
            }

            const exercises = exercisesSnapshot.docs.map((doc) => doc.data());

            // Statistikaları hesabla
            const totalExercises = exercises.length;
            const completedExercises = exercises.filter(
              (ex) => ex.status === "completed"
            ).length;
            const successRate =
              totalExercises > 0
                ? (completedExercises / totalExercises) * 100
                : 0;

            const totalScore = exercises.reduce(
              (sum, ex) => sum + (ex.score || 0),
              0
            );
            const averageScore =
              totalExercises > 0 ? totalScore / totalExercises : 0;

            // Şagird adını al
            const studentDoc = await admin
              .firestore()
              .collection("students")
              .doc(studentEmail)
              .get();

            const studentName = studentDoc.exists
              ? studentDoc.data().fullName
              : "Unknown";

            // Statistikanı yenilə
            await admin
              .firestore()
              .collection("studentCodingStats")
              .doc(studentEmail)
              .set(
                {
                  studentEmail: studentEmail,
                  studentName: studentName,
                  totalExercises: totalExercises,
                  completedExercises: completedExercises,
                  successRate: successRate,
                  totalScore: totalScore,
                  averageScore: averageScore,
                  lastActivityAt: admin.firestore.FieldValue.serverTimestamp(),
                  updatedAt: admin.firestore.FieldValue.serverTimestamp(),
                },
                { merge: true }
              );

            console.log(
              `✅ ${studentEmail} statistikası yeniləndi: ${completedExercises}/${totalExercises} (${successRate.toFixed(
                0
              )}%)`
            );

            return null;
          } catch (error) {
            console.error(
              `❌ Statistika yenilənərkən xəta (${studentEmail}):`,
              error
            );
            return null;
          }
        });

      // 5️⃣ Firestore: users (valideyn)
      await admin
        .firestore()
        .collection("users")
        .doc(parentEmail)
        .set({
          email: parentEmail,
          fullName: parentName || `${fullName} - Valideyn`,
          role: "parent",
          phone: parentPhone || "",
          studentEmail: studentEmail,
          createdAt: admin.firestore.FieldValue.serverTimestamp(),
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        });
      results.success.push(`✅ Firestore users/${parentEmail}`);

      return {
        success: true,
        message: "Şagird və valideyn uğurla yaradıldı!",
        results: results,
      };
    } catch (error) {
      console.error("Error creating student:", error);
      throw new functions.https.HttpsError(
        "internal",
        `Xəta: ${error.message}`
      );
    }
  });
