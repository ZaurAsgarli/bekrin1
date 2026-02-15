/* ============================================
   NOTIFICATION SYSTEM JAVASCRIPT
   Şagird və Valideyn dashboard-ları üçün
   ============================================ */

let allNotifications = [];

// Bildiriş sistemini işə sal
window.initNotifications = function (userEmail) {
  console.log("📬 Bildirişlər yüklənir:", userEmail);

  const db = firebase.firestore();

  db.collection("notifications")
    .where("recipientEmail", "==", userEmail)
    .orderBy("timestamp", "desc")
    .limit(50)
    .onSnapshot(
      (snapshot) => {
        allNotifications = [];
        snapshot.forEach((doc) => {
          allNotifications.push({ id: doc.id, ...doc.data() });
        });
        console.log(`✅ ${allNotifications.length} bildiriş yükləndi`);
        console.log(
          `🔔 Oxunmamış: ${allNotifications.filter((n) => !n.read).length}`
        );
        updateNotificationBadge();
        renderNotifications();
      },
      (error) => {
        console.error("Bildiriş yüklənərkən xəta:", error);
      }
    );
};

// Badge yenilə
function updateNotificationBadge() {
  const unreadCount = allNotifications.filter((n) => !n.read).length;
  const badge = document.getElementById("notificationBadge");

  if (badge) {
    badge.textContent = unreadCount > 0 ? unreadCount : "";
    badge.style.display = unreadCount > 0 ? "flex" : "none";
  }
}

// Panel aç/bağla + hamısını oxunmuş et
window.toggleNotificationPanel = function () {
  const panel = document.getElementById("notificationPanel");
  const isVisible = panel.classList.contains("show");

  if (isVisible) {
    panel.classList.remove("show");
  } else {
    panel.classList.add("show");
    renderNotifications();

    // ✅ Panel açılanda oxunmamış bildirişləri oxunmuş et
    const unreadCount = allNotifications.filter((n) => !n.read).length;
    if (unreadCount > 0) {
      console.log(`📝 ${unreadCount} bildiriş avtomatik oxunmuş edilir...`);
      markAllAsRead();
    }
  }
};

// Bildirişləri göstər (✅ İKONLAR ƏLAVƏ EDİLDİ)
function renderNotifications() {
  const container = document.getElementById("notificationsList");
  if (!container) return;

  if (allNotifications.length === 0) {
    container.innerHTML =
      '<div class="notification-item">Bildiriş yoxdur</div>';
    return;
  }

  container.innerHTML = allNotifications
    .map((notif) => {
      const time = formatTimestamp(notif.timestamp);
      const readClass = notif.read ? "" : "unread";
      const typeClass = notif.type || "default";

      // ✅ Tip üzrə ikon
      const icons = {
        attendance: "📅",
        payment: "💰",
        test_result: "📝",
        default: "📬",
      };
      const icon = icons[notif.type] || icons.default;

      return `
            <div class="notification-item ${readClass} ${typeClass}">
                <div class="notif-header">
                    <strong>${icon} ${notif.studentName || "Şagird"}</strong>
                    <span class="notif-time">${time}</span>
                </div>
                <div class="notif-message">${notif.message || ""}</div>
            </div>
        `;
    })
    .join("");
}

// Bildirişi oxunmuş et
window.markAsRead = async function (notifId) {
  const db = firebase.firestore();
  try {
    await db.collection("notifications").doc(notifId).update({ read: true });
    console.log("✅ Bildiriş oxundu:", notifId);
  } catch (error) {
    console.error("Bildiriş update xətası:", error);
  }
};

// Hamısını oxunmuş et
window.markAllAsRead = async function () {
  const db = firebase.firestore();
  const unreadIds = allNotifications.filter((n) => !n.read).map((n) => n.id);
  if (unreadIds.length === 0) {
    return;
  }
  try {
    const batch = db.batch();
    unreadIds.forEach((id) => {
      const ref = db.collection("notifications").doc(id);
      batch.update(ref, { read: true });
    });
    await batch.commit();
    console.log(`✅ ${unreadIds.length} bildiriş oxunmuş edildi`);
  } catch (error) {
    console.error("Toplu update xətası:", error);
  }
};

// Zaman formatla
function formatTimestamp(timestamp) {
  if (!timestamp) return "Bilinmir";
  const now = Date.now();
  const time = timestamp.toMillis ? timestamp.toMillis() : timestamp;
  const diff = now - time;
  const minutes = Math.floor(diff / 60000);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (minutes < 1) return "İndicə";
  if (minutes < 60) return `${minutes} dəq əvvəl`;
  if (hours < 24) return `${hours} saat əvvəl`;
  return `${days} gün əvvəl`;
}
