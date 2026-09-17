/** Bahasa Indonesia */
export default {
    'layout.title': 'Gunakan tata letak AgentDeck',
    'layout.desc': 'Matikan untuk menghilangkan bilah sisi dan lebar tetap, kembali ke tampilan asli Tabby.',

    'reset.title': 'Atur ulang tata letak',
    'reset.desc': 'Mengembalikan bilah sisi ke keadaan awal — menempel di kanan, dengan lebar dihitung '
        + 'dari rasio jendela.',
    'reset.now': 'Sekarang: menempel di {dock}, {size}.',
    'reset.default': 'Saat ini semuanya dalam keadaan bawaan.',
    'reset.btn': 'Atur ulang',

    'dock.left': 'kiri',
    'dock.right': 'kanan',
    'dock.top': 'atas',
    'dock.bottom': 'bawah',
    'size.width': 'lebar {px} px',
    'size.height': 'tinggi {px} px',
    'size.auto': 'lebar otomatis',

    'norecover.title': 'Jangan pulihkan tab saat mulai',
    'norecover.desc': 'Tabby mulai dalam keadaan kosong alih-alih memulihkan tab lama — yang kembali toh hanya '
        + 'shell-nya, dan sesi Claude di dalamnya sudah lama berakhir. '
        + 'Matikan untuk perilaku asli Tabby (<code>recoverTabs</code>). Berlaku sejak menjalankan berikutnya.',

    'resume.title': 'Lanjutkan sesi sebelumnya',
    'resume.desc': 'Menambahkan laci <code>⟲ Sesi sebelumnya</code> di akhir tiap grup (terlipat secara bawaan). '
        + 'Setelah dibuka, <b>sesi Claude Code dan Codex yang sudah ditutup</b> terdaftar dengan prompt yang '
        + 'benar-benar Anda ketik; sekali klik, percakapan kembali lewat <code>claude --resume</code> atau '
        + '<code>codex resume</code> di folder kerjanya sendiri. Ini pasangan dari '
        + '<b>Jangan pulihkan tab</b> di atas — pemulihan asli mengembalikan shell, yang ini mengembalikan '
        + 'percakapan. '
        + '<b>Server dan proses latar yang tadinya berjalan tidak ikut kembali.</b>',

    'agents.head': 'Integrasi agen',
    'agents.intro': 'Membuat tiap agen <b>melaporkan sendiri</b> status, model, dan batas pemakaiannya. '
        + 'Itulah sumber paling akurat yang dimiliki bilah sisi — tanpanya kami menebak dari teks yang '
        + 'tergambar di layar, dan pembacaannya jadi goyah.',
    'agents.unsupported.title': 'Tidak tersedia di platform ini',
    'agents.unsupported.desc': 'Skrip notifikasi ditulis dengan PowerShell sehingga hanya berjalan di Windows. '
        + 'Status ditebak dari keluaran.',

    'state.on': 'Terhubung',
    'state.off': 'Belum terhubung',
    'state.half': 'Terhubung separuh',
    'btn.install': 'Pasang',
    'btn.remove': 'Hapus',

    'claude.title': 'Integrasi Claude',
    'claude.desc': 'Sesi Claude Code muncul di bilah sisi dengan <b>statusnya</b> '
        + '(bekerja · menunggu persetujuan · selesai) serta <b>bilah model, akun, dan pemakaian</b>. '
        + 'Memasang hook dan <code>statusLine</code> di <code>~/.claude/settings.json</code> sekaligus, '
        + 'dan menghapusnya sekaligus. Hook lain tidak disentuh, dan <code>statusLine</code> yang sudah '
        + 'Anda pakai <b>dijalankan apa adanya</b> sehingga tampilannya tidak berubah. '
        + 'Cadangan ditulis di folder yang sama sebelum menulis.',

    'codex.title': 'Integrasi Codex',
    'codex.desc': 'Sesi Codex muncul di bilah sisi dengan <b>statusnya</b> '
        + '(bekerja · menunggu persetujuan · selesai · terhenti) serta <b>bilah model, akun, dan pemakaian</b>. '
        + 'Setelah dipasang, buka kembali Codex lalu periksa dan percayai hook AgentDeck di <code>/hooks</code>.',

    'codex.disabled': 'Codex mematikan hook berikut — sebelum dinyalakan tidak ada yang masuk: {events}. Buka Codex, jalankan <code>/hooks</code>, lalu percayai hook itu.',

    'root.head': 'Profil folder kerja',
    'root.intro': 'Membuat profil khusus agar tab baru selalu terbuka di folder yang sama. '
        + 'Perubahan berlaku setelah Tabby dijalankan ulang.',
    'root.use.title': 'Gunakan profil folder kerja',
    'root.use.desc': 'Nyalakan lalu isi foldernya — profil dibuat dan menjadi profil bawaan.',
    'root.name.title': 'Nama profil',
    'root.cwd.title': 'Folder kerja',
    'root.cwd.desc': 'Dibiarkan kosong berarti tidak ada profil yang dibuat. Saat mengetik manual, pakai garis '
        + 'miring biasa (mis. D:/Project) untuk menghindari jebakan escape garis miring terbalik.',
    'root.browse': 'Telusuri',
    'root.command.title': 'Perintah',

    'diag.head': 'Laporkan masalah',
    'diag.intro': 'Mengumpulkan log diagnostik menjadi <b>satu berkas zip</b> lalu membuka folder tempatnya. '
        + 'Isinya: versi plugin dan Tabby serta sistem operasi, pengaturan di atas, dan dua generasi terbaru '
        + 'dari <code>{path}</code>. Log memuat <b>judul tab dan jalur berkas yang Anda buka</b> — '
        + 'silakan buka zip-nya untuk memeriksa sebelum mengirim.',
    'diag.screen.title': 'Sertakan isi layar mentah',
    'diag.screen.desc': 'Nyalakan untuk masalah tampilan. Layar terminal ikut apa adanya — pekerjaan dan '
        + 'kode Anda terbaca di dalamnya — karena itu bawaannya mati.',
    'diag.collect.title': 'Kumpulkan log',
    'diag.collect.desc': 'Plugin v{version}.',
    'diag.made': 'Dibuat: ',
    'diag.btn': 'Kumpulkan',

    'dev.head': 'Opsi pengembang',
    'dev.use.title': 'Aktifkan opsi pengembang',
    'dev.use.desc': 'Menyalakan <b>muat ulang langsung</b> — begitu <code>npm run build</code> menulis ulang '
        + '<code>dist/index.js</code>, jendela dimuat ulang ke plugin baru <b>dengan sesi tetap utuh</b> '
        + '(tab menempel kembali ke pty yang sama). Pintasan <b>[dev] Muat ulang plugin</b> juga mengikuti '
        + 'sakelar ini. Jika dimatikan, perubahan dist tidak melakukan apa-apa. '
        + 'Hanya tampil untuk pemasangan dari kode sumber; versi npm tidak memilikinya.',
    'dev.now.title': 'Muat ulang sekarang',
    'dev.now.desc': 'Memuat ulang dist saat ini tanpa proses build.',
    'dev.btn': 'Muat ulang',

    'footer': 'Sisanya — rasio jendela, lebar bilah sisi, opasitas, deteksi status, penanganan masukan — '
        + 'dikunci pada nilai bawaan. Bila perlu diubah, sunting <code>agentDeck.*</code> langsung '
        + 'di berkas konfigurasi. '
        + 'Pintasan ada di tab <b>Pintasan</b> sebagai <code>agentdeck-*</code>.',


    // Settings → Shortcuts (keybind.ts · settings.component.ts)
    'keys.head': 'Pintasan',
    'keys.intro': 'Tombol-tombol dari halaman depan. Tekan <b>Ubah</b>, lalu tombol barunya. Jika sudah dipakai — oleh Tabby sendiri atau oleh AgentDeck — Anda diberi tahu <b>bertabrakan dengan apa</b> dan bisa memilih lagi atau mengambil alih tombolnya. Berlaku seketika.',
    'keys.change': 'Ubah',
    'keys.default': 'Bawaan',
    'keys.cancel': 'Batal',
    'keys.force': 'Tetap pakai',
    'keys.press': 'Tekan tombol baru… (Esc untuk batal)',
    'keys.conflict': 'Bertabrakan dengan {names}. Jika tetap dipakai, tombol itu dilepas dari sana.',
    'keys.unbound': 'belum diatur',
    'keys.stock': 'bawaan Tabby',
    'keys.digit': 'Yang ini harus diakhiri angka 1–9 — angkanya adalah nomor sesi. Tekan mis. Alt+1, maka 2…9 mengikuti.',
    'keys.fixed': '<code>Ctrl+V</code>, <code>Ctrl+W</code>, klik kanan, dan <code>Ctrl+F</code> / <code>Ctrl+S</code> di panel bukan hotkey dan tidak diubah di sini.',
    'keys.item.newtab': 'Tab baru di akar kerja',
    'keys.item.jump': 'Lompat ke sesi ke-N',
    'keys.item.focus': 'Fokus ke daftar sesi / kembali ke terminal',
    'keys.item.view': 'Buka / tutup panel pratinjau',
    'keys.item.repair': 'Perbaiki layar',
    'keys.item.splitright': 'Bagi berdampingan (panel baru di kanan)',
    'keys.item.splitbottom': 'Bagi atas / bawah (panel baru di bawah)',
    'keys.item.closepane': 'Tutup panel terpisah yang aktif',
    'keys.item.newline': 'Baris baru tanpa mengirim',
    'keys.item.toggle': 'Bilah samping / 4:3 nyala-mati',
    'keys.item.viewmode': 'Panel: Berkas ↔ Perubahan',
}
