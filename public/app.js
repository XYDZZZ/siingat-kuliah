/**
 * LOGIKA FRONTEND - SISTEM PENGINGAT JADWAL KULIAH
 * Menggunakan memori internal untuk sesi (TANPA LOCAL STORAGE) sesuai request.
 */

// State Aplikasi (In-Memory)
const appState = {
  token: null,
  currentUser: null,
  activeAuthTab: 'masuk',
  monitoringOtpInterval: null,
  simulatorMessagesInterval: null,
  currentSimulatedPhone: '',
  themePreferences: {
    default: 'tema-default',
    mahasiswa: 'tema-mahasiswa',
    dosen: 'tema-dosen',
    admin: 'tema-admin'
  }
};

// API_BASE otomatis mengikuti origin halaman (lokal & produksi sama).
// Karena backend Express juga yang menyajikan file statis ini, semua endpoint
// /api/* berada di origin yang sama -> cukup pakai window.location.origin.
const API_BASE = window.location.origin;


// --------------------------------------------------------------------------
// 1. EVENT LISTENERS & INITIALIZATION
// --------------------------------------------------------------------------
document.addEventListener('DOMContentLoaded', () => {
  // Inisialisasi tampilan awal
  tampilkanHalamanSesuaiSesi();
  
  // Set up tombol tema di header
  const btnGantiTema = document.getElementById('btn-ganti-tema');
  if (btnGantiTema) {
    btnGantiTema.addEventListener('click', () => {
      document.getElementById('modal-tema').style.display = 'flex';
    });
  }

  // Set up tombol keluar
  const btnKeluar = document.getElementById('btn-keluar');
  if (btnKeluar) {
    btnKeluar.addEventListener('click', handleKeluar);
  }

  // Monitor nomor WA di form pendaftaran untuk sinkronisasi HP virtual di simulator
  const inputDaftarWa = document.getElementById('daftar-whatsapp');
  if (inputDaftarWa) {
    inputDaftarWa.addEventListener('input', (e) => {
      const nomor = e.target.value.trim();
      if (nomor) {
        updateSimulatorPhone(nomor, `Mendaftar sebagai ${getDaftarPeranLabel()}...`);
      }
    });
  }

  const inputMasukWa = document.getElementById('masuk-whatsapp');
  if (inputMasukWa) {
    inputMasukWa.addEventListener('input', (e) => {
      const nomor = e.target.value.trim();
      if (nomor) {
        updateSimulatorPhone(nomor, 'Mengetik nomor untuk masuk...');
      }
    });
  }
});

function getDaftarPeranLabel() {
  const radioPeran = document.getElementsByName('daftar-peran');
  for (let r of radioPeran) {
    if (r.checked) return r.value;
  }
  return 'Pengguna';
}

// --------------------------------------------------------------------------
// 2. THEME & VIEW CONTROLLERS
// --------------------------------------------------------------------------
function aplikasikanTema(tema) {
  const body = document.body;
  // Hapus semua class tema yang ada
  body.classList.remove('tema-default', 'tema-mahasiswa', 'tema-dosen', 'tema-admin');
  
  // Tambahkan class tema baru
  const classTema = appState.themePreferences[tema] || 'tema-default';
  body.classList.add(classTema);
  console.log(`Tema diaplikasikan: ${classTema}`);
}

function tampilkanHalamanSesuaiSesi() {
  const header = document.querySelector('.app-header');
  const sectionAuth = document.getElementById('section-auth');
  const sectionMhs = document.getElementById('section-mahasiswa');
  const sectionDosen = document.getElementById('section-dosen');
  const sectionAdmin = document.getElementById('section-admin');

  // Sembunyikan semua section terlebih dahulu
  sectionAuth.style.display = 'none';
  sectionMhs.style.display = 'none';
  sectionDosen.style.display = 'none';
  sectionAdmin.style.display = 'none';

  if (appState.token && appState.currentUser) {
    // Pengguna sudah masuk
    header.style.display = 'flex';
    document.getElementById('user-display-name').textContent = appState.currentUser.nama;
    
    const peran = appState.currentUser.peran;
    document.getElementById('role-badge').textContent = peran.toUpperCase();
    document.getElementById('role-badge').className = `badge badge-${peran}`;

    // Aplikasikan tema warna berbasis peran pengguna dari cloud database
    aplikasikanTema(appState.currentUser.pilihan_tema || peran);

    // Tampilkan panel yang sesuai peran
    if (peran === 'mahasiswa') {
      sectionMhs.style.display = 'block';
      muatDashboardMahasiswa();
    } else if (peran === 'dosen') {
      sectionDosen.style.display = 'block';
      muatDashboardDosen();
    } else if (peran === 'admin') {
      sectionAdmin.style.display = 'block';
      muatDashboardAdmin();
    }

    // Aktifkan simulator pesan WA untuk nomor pengguna yang login
    updateSimulatorPhone(appState.currentUser.no_whatsapp, 'Online');
  } else {
    // Sesi kosong (Keluar / Belum masuk)
    header.style.display = 'none';
    sectionAuth.style.display = 'flex';
    aplikasikanTema('default'); // Kembali ke tema default
  }
}

// --------------------------------------------------------------------------
// 3. REGISTRASI & AUTENTIKASI (OTP OTOMATIS)
// --------------------------------------------------------------------------
function switchAuthTab(tab) {
  appState.activeAuthTab = tab;
  
  const tabMasuk = document.getElementById('tab-masuk');
  const tabDaftar = document.getElementById('tab-daftar');
  const formMasuk = document.getElementById('form-masuk-container');
  const formDaftar = document.getElementById('form-daftar-container');

  if (tab === 'masuk') {
    tabMasuk.classList.add('active');
    tabDaftar.classList.remove('active');
    formMasuk.style.display = 'block';
    formDaftar.style.display = 'none';
    resetDaftarForm();
    
    const noMasuk = document.getElementById('masuk-whatsapp').value;
    if (noMasuk) updateSimulatorPhone(noMasuk, 'Siap masuk');
  } else {
    tabMasuk.classList.remove('active');
    tabDaftar.classList.add('active');
    formMasuk.style.display = 'none';
    formDaftar.style.display = 'block';
    
    const noDaftar = document.getElementById('daftar-whatsapp').value;
    if (noDaftar) updateSimulatorPhone(noDaftar, 'Siap mendaftar');
  }
}

// Langkah 1 Registrasi: Kirim OTP
async function handleKirimOTP(event) {
  event.preventDefault();
  const nama = document.getElementById('daftar-nama').value.trim();
  const no_whatsapp = document.getElementById('daftar-whatsapp').value.trim();
  const kata_sandi = document.getElementById('daftar-sandi').value;
  const peran = document.querySelector('input[name="daftar-peran"]:checked').value;

  const btn = document.getElementById('btn-kirim-otp');
  btn.disabled = true;
  btn.innerHTML = '<div class="spinner-small"></div> Mengirim OTP...';

  try {
    const respon = await fetch(`${API_BASE}/api/auth/kirim-otp`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ nama, no_whatsapp, kata_sandi, peran })
    });

    const data = await respon.json();

    if (!respon.ok) {
      alert(data.pesan || 'Gagal mengirim OTP.');
      btn.disabled = false;
      btn.innerHTML = '<i class="fa-solid fa-paper-plane"></i> Kirim Kode OTP';
      return;
    }

    // Tampilkan simulator HP & pastikan di-maximize otomatis agar terlihat mulus oleh user
    updateSimulatorPhone(no_whatsapp, 'Menunggu OTP...');
    maximizeSimulator();

    // Pindah ke tampilan Langkah 2 (Verifikasi OTP)
    document.getElementById('form-daftar-step1').style.display = 'none';
    document.getElementById('daftar-step2-verification').style.display = 'block';
    document.getElementById('display-verification-phone').textContent = no_whatsapp;

    // AKTIFKAN AUTO OTP MONITORING (TANPA AKSES MANUAL)
    startAutoOtpMonitoring(no_whatsapp);

  } catch (error) {
    console.error('Error saat kirim OTP:', error);
    alert('Terjadi kesalahan koneksi server.');
    btn.disabled = false;
    btn.innerHTML = '<i class="fa-solid fa-paper-plane"></i> Kirim Kode OTP';
  }
}

// Langkah 2: Memantau OTP Masuk di Simulator secara otomatis
function startAutoOtpMonitoring(noWhatsapp) {
  // Hentikan monitoring lama jika ada
  if (appState.monitoringOtpInterval) {
    clearInterval(appState.monitoringOtpInterval);
  }

  console.log(`Memulai pemantauan OTP otomatis untuk nomor: ${noWhatsapp}`);
  
  appState.monitoringOtpInterval = setInterval(async () => {
    try {
      const respon = await fetch(`${API_BASE}/api/simulasi/otp-terbaru?no_whatsapp=${encodeURIComponent(noWhatsapp)}`);
      const data = await respon.json();

      if (data.sukses && data.otp) {
        console.log(`OTP Otomatis terdeteksi: ${data.otp}`);
        
        // Hentikan pemantauan karena OTP sudah ditemukan
        clearInterval(appState.monitoringOtpInterval);
        appState.monitoringOtpInterval = null;

        // Auto-fill field input OTP
        const inputOtp = document.getElementById('daftar-otp');
        inputOtp.value = data.otp;
        
        // Tambahkan visual highlight hijau
        inputOtp.style.backgroundColor = 'rgba(52, 211, 153, 0.2)';
        inputOtp.style.borderColor = '#10b981';

        // Tampilkan notifikasi kecil
        const infoBox = document.querySelector('.auto-otp-loader');
        infoBox.innerHTML = '<i class="fa-solid fa-circle-check text-success"></i> <span class="text-success"><strong>OTP Terisi Otomatis!</strong> Memverifikasi dalam 1 detik...</span>';

        // Submit form otomatis setelah 1 detik untuk alur super mulus tanpa klik manual
        setTimeout(() => {
          document.getElementById('form-daftar-step2').dispatchEvent(new Event('submit'));
        }, 1200);
      }
    } catch (e) {
      console.error('Gagal memantau OTP otomatis:', e);
    }
  }, 1500); // Poll setiap 1.5 detik
}

// Langkah 3 Registrasi: Verifikasi OTP
async function handleVerifikasiOTP(event) {
  if (event) event.preventDefault();
  const no_whatsapp = document.getElementById('display-verification-phone').textContent;
  const kode_otp = document.getElementById('daftar-otp').value.trim();

  try {
    const respon = await fetch(`${API_BASE}/api/auth/daftar`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ no_whatsapp, kode_otp })
    });

    const data = await respon.json();

    if (!respon.ok) {
      alert(data.pesan || 'Verifikasi OTP gagal.');
      return;
    }

    alert('Registrasi akun berhasil! Silakan masuk ke dalam sistem.');
    
    // Reset dan pindah ke tab masuk
    switchAuthTab('masuk');
    document.getElementById('masuk-whatsapp').value = no_whatsapp;
    updateSimulatorPhone(no_whatsapp, 'Siap masuk');

  } catch (error) {
    console.error('Error saat verifikasi OTP:', error);
    alert('Koneksi terputus saat melakukan verifikasi.');
  }
}

// Login/Masuk
async function handleMasuk(event) {
  event.preventDefault();
  const no_whatsapp = document.getElementById('masuk-whatsapp').value.trim();
  const kata_sandi = document.getElementById('masuk-sandi').value;

  try {
    const respon = await fetch(`${API_BASE}/api/auth/masuk`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ no_whatsapp, kata_sandi })
    });

    const data = await respon.json();

    if (!respon.ok) {
      alert(data.pesan || 'Gagal masuk.');
      return;
    }

    // Simpan sesi login hanya di MEMORI (Tanpa Local Storage)
    appState.token = data.token;
    appState.currentUser = data.pengguna;

    tampilkanHalamanSesuaiSesi();
  } catch (error) {
    console.error('Error saat login:', error);
    alert('Koneksi internet bermasalah atau server mati.');
  }
}

// Keluar / Logout
function handleKeluar() {
  // Bersihkan state memori
  appState.token = null;
  appState.currentUser = null;
  
  if (appState.monitoringOtpInterval) clearInterval(appState.monitoringOtpInterval);
  if (appState.simulatorMessagesInterval) clearInterval(appState.simulatorMessagesInterval);

  tampilkanHalamanSesuaiSesi();
}

function resetDaftarForm() {
  if (appState.monitoringOtpInterval) {
    clearInterval(appState.monitoringOtpInterval);
    appState.monitoringOtpInterval = null;
  }
  document.getElementById('form-daftar-step1').reset();
  document.getElementById('form-daftar-step1').style.display = 'block';
  document.getElementById('daftar-step2-verification').style.display = 'none';
  document.getElementById('daftar-otp').value = '';
  document.getElementById('daftar-otp').style.backgroundColor = '';
  document.getElementById('daftar-otp').style.borderColor = '';
  
  // Kembalikan teks loading
  const btn = document.getElementById('btn-kirim-otp');
  btn.disabled = false;
  btn.innerHTML = '<i class="fa-solid fa-paper-plane"></i> Kirim Kode OTP';
  
  const infoBox = document.querySelector('.auto-otp-loader');
  infoBox.innerHTML = '<div class="spinner-small"></div> <span>Menunggu pesan masuk di simulator WhatsApp... <strong class="text-success">OTP Akan Terisi Otomatis!</strong></span>';
}

// --------------------------------------------------------------------------
// 4. MAHASISWA DASHBOARD LOGIC
// --------------------------------------------------------------------------
async function muatDashboardMahasiswa() {
  try {
    const respon = await fetch(`${API_BASE}/api/matakuliah`, {
      headers: { 'Authorization': `Bearer ${appState.token}` }
    });
    const jadwal = await respon.json();

    const countBadge = document.getElementById('mhs-schedule-count');
    const emptyState = document.getElementById('mhs-schedule-empty');
    const listContainer = document.getElementById('mhs-schedule-list');

    countBadge.textContent = `${jadwal.length} Mata Kuliah`;

    if (jadwal.length === 0) {
      emptyState.style.display = 'block';
      listContainer.style.display = 'none';
      return;
    }

    emptyState.style.display = 'none';
    listContainer.style.display = 'flex';
    listContainer.innerHTML = '';

    jadwal.forEach(mk => {
      const item = document.createElement('div');
      item.className = 'schedule-item-card';
      item.innerHTML = `
        <div class="schedule-item-main">
          <div class="schedule-day-badge">
            <span class="day-txt">${mk.hari.substring(0, 3)}</span>
            <span class="time-txt">${mk.jam_mulai}</span>
          </div>
          <div class="schedule-details">
            <h4>${mk.nama_mk} <span class="course-code-tag">${mk.kode_mk}</span></h4>
            <p>
              <span><i class="fa-solid fa-chalkboard-user"></i> ${mk.nama_dosen}</span>
              <span><i class="fa-solid fa-clock"></i> ${mk.jam_mulai} - ${mk.jam_selesai}</span>
              <span><i class="fa-solid fa-school"></i> Ruang ${mk.ruangan}</span>
            </p>
          </div>
        </div>
        <button class="btn-batal-kelas" onclick="batalAmbilJadwal(${mk.id}, '${mk.nama_mk}')" title="Batalkan Kelas">
          <i class="fa-solid fa-trash-can"></i>
        </button>
      `;
      listContainer.appendChild(item);
    });

  } catch (error) {
    console.error('Error load mhs dashboard:', error);
  }
}

async function handleAmbilJadwal(event) {
  event.preventDefault();
  const kode_mk = document.getElementById('ambil-kode-mk').value.trim();

  try {
    const respon = await fetch(`${API_BASE}/api/ambil-jadwal`, {
      method: 'POST',
      headers: { 
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${appState.token}`
      },
      body: JSON.stringify({ kode_mk })
    });

    const data = await respon.json();

    if (!respon.ok) {
      alert(data.pesan || 'Gagal mengambil jadwal.');
      return;
    }

    alert(data.pesan);
    document.getElementById('form-ambil-jadwal').reset();
    muatDashboardMahasiswa();

  } catch (error) {
    console.error('Error ambil jadwal:', error);
    alert('Terjadi kesalahan koneksi.');
  }
}

async function batalAmbilJadwal(idMatakuliah, namaMk) {
  if (!confirm(`Apakah Anda yakin ingin membatalkan pendaftaran kelas '${namaMk}'?`)) return;

  try {
    const respon = await fetch(`${API_BASE}/api/batal-jadwal`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${appState.token}`
      },
      body: JSON.stringify({ id_matakuliah: idMatakuliah })
    });

    const data = await respon.json();
    if (!respon.ok) {
      alert(data.pesan || 'Gagal membatalkan kelas.');
      return;
    }

    alert(data.pesan);
    muatDashboardMahasiswa();
  } catch (error) {
    console.error('Error batal jadwal:', error);
  }
}

// --------------------------------------------------------------------------
// 5. DOSEN DASHBOARD LOGIC
// --------------------------------------------------------------------------
async function muatDashboardDosen() {
  try {
    const respon = await fetch(`${API_BASE}/api/matakuliah`, {
      headers: { 'Authorization': `Bearer ${appState.token}` }
    });
    const kelasList = await respon.json();

    const countBadge = document.getElementById('dosen-class-count');
    const emptyState = document.getElementById('dosen-class-empty');
    const listContainer = document.getElementById('dosen-class-list');

    countBadge.textContent = `${kelasList.length} Kelas`;

    if (kelasList.length === 0) {
      emptyState.style.display = 'block';
      listContainer.style.display = 'none';
      return;
    }

    emptyState.style.display = 'none';
    listContainer.style.display = 'flex';
    listContainer.innerHTML = '';

    kelasList.forEach(mk => {
      const item = document.createElement('div');
      item.className = 'glass-card schedule-item-card';
      item.style.flexDirection = 'column';
      item.style.alignItems = 'stretch';
      item.style.gap = '0.75rem';

      // Buat daftar nama mahasiswa
      const mhsList = mk.daftar_mahasiswa || [];
      const mhsTagsHtml = mhsList.length > 0 
        ? mhsList.map(m => `<span class="mhs-roster-tag"><i class="fa-solid fa-user-graduate"></i> ${m.nama} (${m.no_whatsapp})</span>`).join('')
        : '<span class="text-secondary" style="font-size: 0.75rem; font-style: italic;">Belum ada mahasiswa yang mengambil kelas ini.</span>';

      item.innerHTML = `
        <div class="class-header-row">
          <div class="schedule-item-main">
            <div class="schedule-day-badge">
              <span class="day-txt">${mk.hari.substring(0, 3)}</span>
              <span class="time-txt">${mk.jam_mulai}</span>
            </div>
            <div class="schedule-details">
              <h4>${mk.nama_mk} <span class="course-code-tag" title="Kode MK untuk mahasiswa">${mk.kode_mk}</span></h4>
              <p>
                <span><i class="fa-solid fa-clock"></i> ${mk.jam_mulai} - ${mk.jam_selesai}</span>
                <span><i class="fa-solid fa-school"></i> Ruang ${mk.ruangan}</span>
              </p>
            </div>
          </div>
          <button class="btn-batal-kelas" onclick="hapusMataKuliah(${mk.id}, '${mk.nama_mk}')" title="Hapus Kelas">
            <i class="fa-solid fa-trash-can"></i>
          </button>
        </div>
        <div class="class-stats-mhs">
          <h5><i class="fa-solid fa-users"></i> Roster Mahasiswa (${mhsList.length} orang)</h5>
          <div class="mhs-roster-tags">
            ${mhsTagsHtml}
          </div>
        </div>
      `;
      listContainer.appendChild(item);
    });

  } catch (error) {
    console.error('Error load dosen dashboard:', error);
  }
}

async function handleTambahMk(event) {
  event.preventDefault();
  const nama_mk = document.getElementById('tambah-nama-mk').value.trim();
  const hari = document.getElementById('tambah-hari').value;
  const ruangan = document.getElementById('tambah-ruangan').value.trim();
  const jam_mulai = document.getElementById('tambah-jam-mulai').value;
  const jam_selesai = document.getElementById('tambah-jam-selesai').value;
  const kode_mk_kustom = document.getElementById('tambah-kode-kustom').value.trim();

  try {
    const respon = await fetch(`${API_BASE}/api/matakuliah`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${appState.token}`
      },
      body: JSON.stringify({ nama_mk, hari, ruangan, jam_mulai, jam_selesai, kode_mk_kustom })
    });

    const data = await respon.json();

    if (!respon.ok) {
      alert(data.pesan || 'Gagal menambahkan mata kuliah.');
      return;
    }

    alert(`Sukses! Kelas diterbitkan dengan Kode MK: ${data.matakuliah.kode_mk}`);
    document.getElementById('form-tambah-mk').reset();
    muatDashboardDosen();
  } catch (error) {
    console.error('Error tambah mk:', error);
    alert('Terjadi kesalahan koneksi.');
  }
}

async function hapusMataKuliah(id, namaMk) {
  if (!confirm(`Apakah Anda yakin ingin menghapus kelas '${namaMk}' permanen? Semua data mahasiswa di kelas ini akan ikut terhapus.`)) return;

  try {
    const respon = await fetch(`${API_BASE}/api/matakuliah/${id}`, {
      method: 'DELETE',
      headers: { 'Authorization': `Bearer ${appState.token}` }
    });

    const data = await respon.json();
    alert(data.pesan);
    muatDashboardDosen();
  } catch (error) {
    console.error('Error hapus mk:', error);
  }
}

// --------------------------------------------------------------------------
// 6. ADMIN DASHBOARD LOGIC
// --------------------------------------------------------------------------
async function muatDashboardAdmin() {
  try {
    // A. Muat statistik ringkas
    const userRes = await fetch(`${API_BASE}/api/admin/pengguna`, {
      headers: { 'Authorization': `Bearer ${appState.token}` }
    });
    const users = await userRes.json();
    document.getElementById('stat-total-pengguna').textContent = users.length;

    const mkRes = await fetch(`${API_BASE}/api/matakuliah/semua`, {
      headers: { 'Authorization': `Bearer ${appState.token}` }
    });
    const allMk = await mkRes.json();
    document.getElementById('stat-total-mk').textContent = allMk.length;

    // Dapatkan statistik notifikasi
    // Menggunakan list simulasi in-memory backend
    const logRes = await fetch(`${API_BASE}/api/simulasi/pesan`);
    const allLogs = await logRes.json();
    document.getElementById('stat-total-pengingat').textContent = allLogs.length;

    // B. Render tabel pengguna
    const userTableBody = document.getElementById('admin-users-table-body');
    userTableBody.innerHTML = '';
    users.forEach(u => {
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td><strong>${u.nama}</strong></td>
        <td>${u.no_whatsapp}</td>
        <td><span class="badge" style="background-color: var(--border-color);">${u.peran.toUpperCase()}</span></td>
        <td>
          <span class="text-${u.apakah_diverifikasi ? 'success' : 'danger'}">
            <i class="fa-solid ${u.apakah_diverifikasi ? 'fa-circle-check' : 'fa-circle-xmark'}"></i> 
            ${u.apakah_diverifikasi ? 'Diverifikasi' : 'Belum Verifikasi'}
          </span>
        </td>
      `;
      userTableBody.appendChild(tr);
    });

    // C. Render tabel mata kuliah
    const courseTableBody = document.getElementById('admin-courses-table-body');
    courseTableBody.innerHTML = '';
    allMk.forEach(mk => {
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td><span class="course-code-tag">${mk.kode_mk}</span></td>
        <td><strong>${mk.nama_mk}</strong><br><small class="text-secondary">Ruang ${mk.ruangan}</small></td>
        <td>${mk.nama_dosen}</td>
        <td>${mk.hari}, ${mk.jam_mulai} - ${mk.jam_selesai}</td>
        <td><span class="badge" style="background-color: var(--accent-light); color: var(--accent-color);">${mk.total_mahasiswa || 0}</span></td>
        <td>
          <button class="btn-batal-kelas" onclick="hapusMataKuliahAdmin(${mk.id}, '${mk.nama_mk}')" title="Hapus Kelas">
            <i class="fa-solid fa-trash-can"></i>
          </button>
        </td>
      `;
      courseTableBody.appendChild(tr);
    });

  } catch (error) {
    console.error('Error load admin dashboard:', error);
  }
}

async function hapusMataKuliahAdmin(id, namaMk) {
  if (!confirm(`Admin: Hapus permanen kelas '${namaMk}'?`)) return;
  try {
    const respon = await fetch(`${API_BASE}/api/matakuliah/${id}`, {
      method: 'DELETE',
      headers: { 'Authorization': `Bearer ${appState.token}` }
    });
    const data = await respon.json();
    alert(data.pesan);
    muatDashboardAdmin();
  } catch (error) {
    console.error('Error hapus mk admin:', error);
  }
}

// --------------------------------------------------------------------------
// 7. SINKRONISASI TEMA KE CLOUD DATABASE
// --------------------------------------------------------------------------
async function pilihTemaAplikasi(tema) {
  // Jika sedang login, sinkronisasikan preferensi tema ke database cloud
  if (appState.token && appState.currentUser) {
    try {
      const respon = await fetch(`${API_BASE}/api/pengguna/tema`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${appState.token}`
        },
        body: JSON.stringify({ tema })
      });
      
      const data = await respon.json();
      if (respon.ok) {
        appState.currentUser.pilihan_tema = tema;
        aplikasikanTema(tema);
        tampilkanHalamanSesuaiSesi();
      }
    } catch (e) {
      console.error('Gagal sinkronisasi tema ke cloud database:', e);
      aplikasikanTema(tema);
    }
  } else {
    // Jika belum login (di halaman auth), aplikasikan sementara secara lokal
    aplikasikanTema(tema);
  }
  tutupModalTema();
}

function tutupModalTema() {
  document.getElementById('modal-tema').style.display = 'none';
}

// --------------------------------------------------------------------------
// 8. FLOATING WHATSAPP SMARTPHONE SIMULATOR
// --------------------------------------------------------------------------
function toggleSimulator() {
  const widget = document.getElementById('wa-simulator-widget');
  const icon = document.getElementById('simulator-toggle-icon');
  
  if (widget.classList.contains('minimized')) {
    widget.classList.remove('minimized');
    icon.className = 'fa-solid fa-chevron-down';
    // Load pesan segera
    muatPesanSimulator();
  } else {
    widget.classList.add('minimized');
    icon.className = 'fa-solid fa-chevron-up';
  }
}

function maximizeSimulator() {
  const widget = document.getElementById('wa-simulator-widget');
  const icon = document.getElementById('simulator-toggle-icon');
  widget.classList.remove('minimized');
  icon.className = 'fa-solid fa-chevron-down';
  muatPesanSimulator();
}

function updateSimulatorPhone(noWhatsapp, statusText = 'Online') {
  appState.currentSimulatedPhone = noWhatsapp;
  document.getElementById('wa-phone-subtitle').innerHTML = `<i class="fa-solid fa-circle text-success" style="font-size: 0.5rem;"></i> ${noWhatsapp} (${statusText})`;
  
  // Bersihkan interval monitoring pesan HP lama
  if (appState.simulatorMessagesInterval) {
    clearInterval(appState.simulatorMessagesInterval);
  }

  // Muat pesan pertama kali
  muatPesanSimulator();

  // Mulai pooling pesan masuk ke simulator setiap 3 detik
  appState.simulatorMessagesInterval = setInterval(() => {
    muatPesanSimulator();
  }, 3000);
}

async function muatPesanSimulator() {
  if (!appState.currentSimulatedPhone) return;

  try {
    const respon = await fetch(`${API_BASE}/api/simulasi/pesan?no_whatsapp=${encodeURIComponent(appState.currentSimulatedPhone)}`);
    const listPesan = await respon.json();

    const chatBody = document.getElementById('wa-chat-messages-body');
    chatBody.innerHTML = '';

    if (listPesan.length === 0) {
      chatBody.innerHTML = `
        <div class="wa-system-message">
          Belum ada pesan masuk untuk nomor <strong>${appState.currentSimulatedPhone}</strong>.<br>
          Pesan OTP atau pengingat jadwal kuliah akan tampil otomatis di sini jika dikirim.
        </div>
      `;
      return;
    }

    // Tampilkan pesan dalam urutan kronologis (terlama di atas, terbaru di bawah)
    const reversed = [...listPesan].reverse();
    
    reversed.forEach(p => {
      const jam = new Date(p.dikirim_pada).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' });
      const bubble = document.createElement('div');
      // OTP & Pengingat dikirim ke user (received di sisi HP)
      bubble.className = `wa-bubble received`;
      bubble.innerHTML = `
        ${formatPesanWA(p.pesan)}
        <span class="wa-bubble-time">${jam}</span>
      `;
      chatBody.appendChild(bubble);
    });

    // Auto-scroll ke bawah saat ada pesan baru
    chatBody.scrollTop = chatBody.scrollHeight;

  } catch (error) {
    console.error('Error load simulator messages:', error);
  }
}

// Format tulisan tebal *teks* menjadi HTML <strong>teks</strong> untuk chat WhatsApp yang realistis
function formatPesanWA(teks) {
  // Ganti baris baru \n dengan <br>
  let html = teks.replace(/\n/g, '<br>');
  // Ganti *teks* dengan <strong>teks</strong>
  html = html.replace(/\*([^*]+)\*/g, '<strong>$1</strong>');
  return html;
}

// Mengirim pesan manual via simulator (hanya untuk simulasi chat timbal balik/pengujian)
async function kirimPesanManualSimulator() {
  const input = document.getElementById('wa-chat-input-test');
  const pesan = input.value.trim();
  if (!pesan || !appState.currentSimulatedPhone) return;

  try {
    const respon = await fetch(`${API_BASE}/api/simulasi/kirim-manual`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        no_whatsapp: appState.currentSimulatedPhone,
        pesan: pesan
      })
    });

    if (respon.ok) {
      input.value = '';
      muatPesanSimulator();
      
      // Jika admin terdeteksi, muat ulang dashboardnya untuk melihat statistik pesan terupdate
      if (appState.currentUser && appState.currentUser.peran === 'admin') {
        muatDashboardAdmin();
      }
    }
  } catch (e) {
    console.error('Gagal mengirim pesan manual simulator:', e);
  }
}
