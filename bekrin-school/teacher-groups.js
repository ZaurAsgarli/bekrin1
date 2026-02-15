// Firebase konfiqurasiyası
const firebaseConfig = {
  apiKey: "AIzaSyDE05ufg0FhPIAecIJ_ehr9yIFQKxIwncA",
  authDomain: "bekrinschool.firebaseapp.com",
  projectId: "bekrinschool",
  storageBucket: "bekrinschool.firebasestorage.app",
  messagingSenderId: "678081137706",
  appId: "1:678081137706:web:75601b998dde21f25f0753"
};


// Firebase initialize
if (!firebase.apps.length) {
    firebase.initializeApp(firebaseConfig);
}

const auth = firebase.auth();
const db = firebase.firestore();

let currentUser = null;
let currentGroupId = null;
let allGroups = [];
let currentViewingGroup = null;
let selectedStudentsToAdd = [];
let editModeActive = false;
let studentToMove = null; // ← YENİ

// UI elementlər
const groupsContainer = document.getElementById('groupsContainer');
const emptyState = document.getElementById('emptyState');
const groupModal = document.getElementById('groupModal');
const groupForm = document.getElementById('groupForm');
const addGroupBtn = document.getElementById('addGroupBtn');
const cancelBtn = document.getElementById('cancelBtn');
const sortBtn = document.getElementById('sortBtn');
const toggleEditBtn = document.getElementById('toggleEditBtn');
const modalTitle = document.getElementById('modalTitle');
const groupNameInput = document.getElementById('groupName');

// Qrup detayları modal elementləri
const groupDetailsModal = document.getElementById('groupDetailsModal');
const studentSelectModal = document.getElementById('studentSelectModal');
const groupChangeModal = document.getElementById('groupChangeModal'); // ← YENİ
const closeDetailsBtn = document.getElementById('closeDetailsBtn');
const closeSelectBtn = document.getElementById('closeSelectBtn');
const closeChangeBtn = document.getElementById('closeChangeBtn'); // ← YENİ
const addStudentToGroupBtn = document.getElementById('addStudentToGroupBtn');
const cancelSelectBtn = document.getElementById('cancelSelectBtn');
const confirmAddStudentsBtn = document.getElementById('confirmAddStudentsBtn');

// Auth yoxlama
auth.onAuthStateChanged(async (user) => {
    if (!user) {
        window.location.href = 'index.html';
        return;
    }

    const userDoc = await db.collection('users').doc(user.email).get();
    if (!userDoc.exists || userDoc.data().role !== 'teacher') {
        alert('Bu səhifəyə yalnız müəllimlər daxil ola bilər!');
        window.location.href = 'index.html';
        return;
    }

    currentUser = user;
    loadGroups();
});

// Düzəliş rejimini toggle et
toggleEditBtn.addEventListener('click', () => {
    editModeActive = !editModeActive;
    
    if (editModeActive) {
        toggleEditBtn.classList.add('active');
        toggleEditBtn.textContent = '❌ Düzəliş Rejiminə Bağla';
    } else {
        toggleEditBtn.classList.remove('active');
        toggleEditBtn.textContent = '✏️ Düzəliş Rejimi';
    }
    
    // Bütün group-actions-ları göstər/gizlə
    document.querySelectorAll('.group-actions').forEach(actions => {
        if (editModeActive) {
            actions.classList.add('visible');
        } else {
            actions.classList.remove('visible');
        }
    });
});

// Qrupları yüklə
async function loadGroups() {
    try {
        const snapshot = await db.collection('groups')
            .where('teacherEmail', '==', currentUser.email)
            .where('active', '==', true)
            .get();

        allGroups = [];
        snapshot.forEach(doc => {
            allGroups.push({ id: doc.id, ...doc.data() });
        });

        // Sıralama: order varsa ona görə, yoxdursa adına görə
        allGroups.sort((a, b) => {
            if (a.order !== undefined && b.order !== undefined) {
                return a.order - b.order;
            }
            return (a.name || '').localeCompare(b.name || '');
        });

        displayGroups();
    } catch (error) {
        console.error('Qruplar yüklənərkən xəta:', error);
        alert('Qruplar yüklənərkən xəta baş verdi!');
    }
}

// Qrupları göstər
function displayGroups() {
    if (allGroups.length === 0) {
        groupsContainer.style.display = 'none';
        emptyState.style.display = 'block';
        return;
    }

    groupsContainer.style.display = 'flex';
    emptyState.style.display = 'none';

    groupsContainer.innerHTML = allGroups.map(group => `
        <div class="group-card" data-group-id="${group.id}">
            <div class="group-info" onclick="viewGroupDetails('${group.id}')">
                <div class="group-name">
                    🎓 ${group.name}
                </div>
                <div class="student-count">
                    <span>📊 Şagird sayı:</span>
                    <strong>${group.students ? group.students.length : 0}</strong>
                </div>
            </div>
            <div class="group-actions ${editModeActive ? 'visible' : ''}">
                <button class="edit-btn" onclick="event.stopPropagation(); editGroup('${group.id}');">✏️ Düzəliş</button>
                <button class="delete-btn" onclick="event.stopPropagation(); deleteGroup('${group.id}');">🗑️ Sil</button>
            </div>
        </div>
    `).join('');
}

// Qrup detaylarını göstər
window.viewGroupDetails = async function(groupId) {
    try {
        const groupDoc = await db.collection('groups').doc(groupId).get();
        if (!groupDoc.exists) {
            alert('Qrup tapılmadı!');
            return;
        }

        currentViewingGroup = { id: groupDoc.id, ...groupDoc.data() };
        
        document.getElementById('detailsGroupName').textContent = `📚 ${currentViewingGroup.name}`;
        document.getElementById('studentCountDetail').textContent = currentViewingGroup.students?.length || 0;

        await loadGroupStudents();
        
        groupDetailsModal.classList.add('active');
    } catch (error) {
        console.error('Qrup detayları yüklənərkən xəta:', error);
        alert('Xəta baş verdi!');
    }
};

// Qrup şagirdlərini yüklə
async function loadGroupStudents() {
    const studentList = document.getElementById('studentList');
    const studentEmails = currentViewingGroup.students || [];

    if (studentEmails.length === 0) {
        studentList.innerHTML = '<div class="empty-students">Bu qrupda hələ şagird yoxdur</div>';
        return;
    }

    try {
        const students = [];
        for (const email of studentEmails) {
            const studentDoc = await db.collection('students').doc(email).get();
            if (studentDoc.exists) {
                students.push({ email, ...studentDoc.data() });
            }
        }

        studentList.innerHTML = students.map(student => {
            const initials = student.fullName.split(' ').map(n => n[0]).join('').toUpperCase();
            return `
                <div class="student-item">
                    <div class="student-info">
                        <div class="student-avatar">${initials}</div>
                        <div class="student-name-detail">${student.fullName}</div>
                    </div>
                    <div class="student-actions">
                        <button class="move-student-btn" onclick="openMoveStudentModal('${student.email}', '${student.fullName.replace(/'/g, "\\'")}')">
                            🔄 Dəyiş
                        </button>
                        <button class="remove-student-btn" onclick="removeStudentFromGroup('${student.email}')">
                            ❌ Çıxar
                        </button>
                    </div>
                </div>
            `;
        }).join('');
    } catch (error) {
        console.error('Şagirdlər yüklənərkən xəta:', error);
        studentList.innerHTML = '<div class="empty-students">Xəta baş verdi</div>';
    }
}

// ← YENİ: Şagird köçürmə modalını aç
window.openMoveStudentModal = function(studentEmail, studentName) {
    studentToMove = { email: studentEmail, name: studentName };
    
    document.getElementById('changeStudentName').textContent = studentName;
    
    // Mövcud qrupdan başqa qrupları göstər
    const otherGroups = allGroups.filter(g => g.id !== currentViewingGroup.id);
    
    const groupChangeList = document.getElementById('groupChangeList');
    
    if (otherGroups.length === 0) {
        groupChangeList.innerHTML = '<div class="empty-students">Başqa qrup yoxdur</div>';
    } else {
        groupChangeList.innerHTML = otherGroups.map(group => `
            <div class="group-change-item" onclick="moveStudentToGroup('${group.id}')">
                <div class="group-info-text">
                    <div class="group-name-text">🎓 ${group.name}</div>
                    <div class="student-count-text">Şagird sayı: ${group.students?.length || 0}</div>
                </div>
            </div>
        `).join('');
    }
    
    groupChangeModal.classList.add('active');
};

// ← YENİ: Şagirdi başqa qrupa köçür
window.moveStudentToGroup = async function(targetGroupId) {
    if (!studentToMove) return;
    
    try {
        const targetGroup = allGroups.find(g => g.id === targetGroupId);
        
        if (!confirm(`${studentToMove.name} şagirdini "${targetGroup.name}" qrupuna köçürmək istəyirsiniz?`)) {
            return;
        }
        
        // Köhnə qrupdan çıxar
        const updatedOldStudents = currentViewingGroup.students.filter(e => e !== studentToMove.email);
        await db.collection('groups').doc(currentViewingGroup.id).update({
            students: updatedOldStudents,
            updatedAt: firebase.firestore.FieldValue.serverTimestamp()
        });
        
        // Yeni qrupa əlavə et
        const updatedNewStudents = [...(targetGroup.students || []), studentToMove.email];
        await db.collection('groups').doc(targetGroupId).update({
            students: updatedNewStudents,
            updatedAt: firebase.firestore.FieldValue.serverTimestamp()
        });
        
        alert(`✅ ${studentToMove.name} "${targetGroup.name}" qrupuna köçürüldü!`);
        
        // Yenilə
        currentViewingGroup.students = updatedOldStudents;
        await loadGroupStudents();
        document.getElementById('studentCountDetail').textContent = updatedOldStudents.length;
        
        groupChangeModal.classList.remove('active');
        loadGroups();
        
    } catch (error) {
        console.error('Şagird köçürülürkən xəta:', error);
        alert('Xəta baş verdi!');
    }
};

// Şagird seçimi modalını aç
addStudentToGroupBtn.addEventListener('click', async () => {
    try {
        const snapshot = await db.collection('students')
            .where('status', '==', 'active')
            .get();

        const allStudents = [];
        snapshot.forEach(doc => {
            allStudents.push({ email: doc.id, ...doc.data() });
        });

        const groupStudentEmails = currentViewingGroup.students || [];
        const availableStudents = allStudents.filter(s => !groupStudentEmails.includes(s.email));

        if (availableStudents.length === 0) {
            alert('Bütün şagirdlər artıq bu qrupdadır!');
            return;
        }

        const studentSelectList = document.getElementById('studentSelectList');
        studentSelectList.innerHTML = availableStudents.map(student => `
            <div class="student-select-item" data-email="${student.email}" onclick="toggleStudentSelection('${student.email}')">
                <strong>${student.fullName}</strong><br>
                <small>${student.email} • Sinif: ${student.class || 'N/A'}</small>
            </div>
        `).join('');

        selectedStudentsToAdd = [];
        studentSelectModal.classList.add('active');

    } catch (error) {
        console.error('Şagirdlər yüklənərkən xəta:', error);
        alert('Xəta baş verdi!');
    }
});

// Şagird seçimini toggle et
window.toggleStudentSelection = function(email) {
    const item = document.querySelector(`.student-select-item[data-email="${email}"]`);
    
    if (selectedStudentsToAdd.includes(email)) {
        selectedStudentsToAdd = selectedStudentsToAdd.filter(e => e !== email);
        item.classList.remove('selected');
    } else {
        selectedStudentsToAdd.push(email);
        item.classList.add('selected');
    }
};

// Seçilən şagirdləri qrupa əlavə et
confirmAddStudentsBtn.addEventListener('click', async () => {
    if (selectedStudentsToAdd.length === 0) {
        alert('Heç bir şagird seçilməyib!');
        return;
    }

    try {
        const updatedStudents = [...(currentViewingGroup.students || []), ...selectedStudentsToAdd];

        await db.collection('groups').doc(currentViewingGroup.id).update({
            students: updatedStudents,
            updatedAt: firebase.firestore.FieldValue.serverTimestamp()
        });

        alert(`✅ ${selectedStudentsToAdd.length} şagird qrupa əlavə edildi!`);

        currentViewingGroup.students = updatedStudents;
        await loadGroupStudents();
        document.getElementById('studentCountDetail').textContent = updatedStudents.length;

        studentSelectModal.classList.remove('active');
        loadGroups();

    } catch (error) {
        console.error('Şagird əlavə edilərkən xəta:', error);
        alert('Xəta baş verdi!');
    }
});

// Şagirdi qrupdan çıxar
window.removeStudentFromGroup = async function(studentEmail) {
    if (!confirm('Bu şagirdi qrupdan çıxarmaq istədiyinizə əminsiniz?')) {
        return;
    }

    try {
        const updatedStudents = currentViewingGroup.students.filter(e => e !== studentEmail);

        await db.collection('groups').doc(currentViewingGroup.id).update({
            students: updatedStudents,
            updatedAt: firebase.firestore.FieldValue.serverTimestamp()
        });

        alert('✅ Şagird qrupdan çıxarıldı!');

        currentViewingGroup.students = updatedStudents;
        await loadGroupStudents();
        document.getElementById('studentCountDetail').textContent = updatedStudents.length;

        loadGroups();

    } catch (error) {
        console.error('Şagird çıxarılarkən xəta:', error);
        alert('Xəta baş verdi!');
    }
};

// Modal bağlama
closeDetailsBtn.addEventListener('click', () => {
    groupDetailsModal.classList.remove('active');
});

closeSelectBtn.addEventListener('click', () => {
    studentSelectModal.classList.remove('active');
});

cancelSelectBtn.addEventListener('click', () => {
    studentSelectModal.classList.remove('active');
});

closeChangeBtn.addEventListener('click', () => {
    groupChangeModal.classList.remove('active');
});

// A-Z Sıralama
sortBtn.addEventListener('click', async () => {
    if (allGroups.length === 0) {
        alert('Qrup yoxdur!');
        return;
    }

    const confirm = window.confirm('Qrupları A-Z sıralayıb saxlamaq istəyirsiniz?');
    if (!confirm) return;

    try {
        sortBtn.disabled = true;
        sortBtn.textContent = '⏳ Saxlanılır...';

        allGroups.sort((a, b) => a.name.localeCompare(b.name));

        const batch = db.batch();
        allGroups.forEach((group, index) => {
            const groupRef = db.collection('groups').doc(group.id);
            batch.update(groupRef, { order: index });
        });

        await batch.commit();

        alert('✅ Qruplar A-Z sıralandı!');
        loadGroups();

    } catch (error) {
        console.error('Sıralama xətası:', error);
        alert('Xəta baş verdi!');
    } finally {
        sortBtn.disabled = false;
        sortBtn.textContent = '🔤 A-Z Sırala';
    }
});

// Yeni qrup modal
addGroupBtn.addEventListener('click', () => {
    currentGroupId = null;
    modalTitle.textContent = 'Yeni Qrup';
    groupNameInput.value = '';
    groupModal.classList.add('active');
});

// Modal bağla
cancelBtn.addEventListener('click', () => {
    groupModal.classList.remove('active');
});

// Form submit
groupForm.addEventListener('submit', async (e) => {
    e.preventDefault();

    const groupName = groupNameInput.value.trim();
    if (!groupName) {
        alert('Qrup adı boş ola bilməz!');
        return;
    }

    try {
        if (currentGroupId) {
            await db.collection('groups').doc(currentGroupId).update({
                name: groupName,
                updatedAt: firebase.firestore.FieldValue.serverTimestamp()
            });
            alert('✅ Qrup yeniləndi!');
        } else {
            const maxOrder = allGroups.length > 0 
                ? Math.max(...allGroups.map(g => g.order || 0)) 
                : -1;

            await db.collection('groups').add({
                name: groupName,
                teacherEmail: currentUser.email,
                students: [],
                active: true,
                order: maxOrder + 1,
                createdAt: firebase.firestore.FieldValue.serverTimestamp()
            });
            alert('✅ Qrup yaradıldı!');
        }

        groupModal.classList.remove('active');
        loadGroups();
    } catch (error) {
        console.error('Qrup əlavə edilərkən xəta:', error);
        alert('Xəta baş verdi!');
    }
});

// Qrupu düzəliş et
window.editGroup = async (groupId) => {
    currentGroupId = groupId;
    const group = allGroups.find(g => g.id === groupId);

    if (group) {
        modalTitle.textContent = 'Qrupu Düzəliş Et';
        groupNameInput.value = group.name;
        groupModal.classList.add('active');
    }
};

// Qrupu sil
window.deleteGroup = async (groupId) => {
    const group = allGroups.find(g => g.id === groupId);
    if (!confirm(`"${group.name}" qrupunu silmək istədiyinizə əminsiniz?`)) {
        return;
    }

    try {
        await db.collection('groups').doc(groupId).update({
            active: false,
            deletedAt: firebase.firestore.FieldValue.serverTimestamp()
        });
        alert('✅ Qrup silindi!');
        loadGroups();
    } catch (error) {
        console.error('Qrup silinərkən xəta:', error);
        alert('Xəta baş verdi!');
    }
};
