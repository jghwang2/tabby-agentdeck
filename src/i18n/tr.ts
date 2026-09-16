/** Türkçe */
export default {
    'layout.title': 'AgentDeck düzenini kullan',
    'layout.desc': 'Kapatırsanız kenar çubuğu ve sabit genişlik kaybolur, Tabby’nin özgün görünümüne dönersiniz.',

    'reset.title': 'Düzeni sıfırla',
    'reset.desc': 'Kenar çubuğunu ilk hâline döndürür — sağa yaslı ve genişliği pencere oranından hesaplanmış.',
    'reset.now': 'Şu an: {dock} yaslı, {size}.',
    'reset.default': 'Şu anda her şey varsayılan durumda.',
    'reset.btn': 'Sıfırla',

    'dock.left': 'sola',
    'dock.right': 'sağa',
    'dock.top': 'üste',
    'dock.bottom': 'alta',
    'size.width': 'genişlik {px} px',
    'size.height': 'yükseklik {px} px',
    'size.auto': 'genişlik otomatik',

    'norecover.title': 'Açılışta sekmeleri geri yükleme',
    'norecover.desc': 'Tabby eski sekmeleri geri getirmek yerine boş açılır — geri gelen zaten yalnızca kabuk, '
        + 'içindeki Claude oturumu çoktan bitmiş oluyor. '
        + 'Kapatırsanız Tabby’nin özgün davranışına (<code>recoverTabs</code>) dönersiniz. '
        + 'Bir sonraki açılıştan itibaren geçerlidir.',

    'resume.title': 'Geçmiş oturumları sürdür',
    'resume.desc': 'Her grubun sonuna <code>⟲ Geçmiş oturumlar</code> çekmecesi ekler (varsayılan olarak kapalı). '
        + 'Açtığınızda <b>kapanmış Claude Code ve Codex oturumları</b> gerçekten yazdığınız istemle listelenir; '
        + 'birine tıklayınca konuşma, kendi çalışma klasöründe <code>claude --resume</code> ya da '
        + '<code>codex resume</code> ile geri gelir. Bu, yukarıdaki <b>Açılışta sekmeleri geri yükleme</b> '
        + 'ayarının diğer yarısıdır — özgün geri yükleme kabuğu getirir, bu ise konuşmayı getirir. '
        + '<b>O sırada açık olan sunucular ve arka plan süreçleri geri gelmez.</b>',

    'agents.head': 'Aracı entegrasyonu',
    'agents.intro': 'Her aracının durumunu, kullandığı modeli ve kullanım sınırlarını <b>kendisinin bildirmesini</b> '
        + 'sağlar. Kenar çubuğunun sahip olduğu en doğru kaynak budur — bağlamazsanız ekrana çizilen yazıdan '
        + 'tahmin ederiz ve okuma o ölçüde oynar.',
    'agents.unsupported.title': 'Bu platformda kullanılamaz',
    'agents.unsupported.desc': 'Bildirim betiği PowerShell olduğundan yalnızca Windows’ta çalışır. '
        + 'Durum bunun yerine çıktıdan tahmin edilir.',

    'state.on': 'Bağlı',
    'state.off': 'Bağlı değil',
    'state.half': 'Yarım bağlı',
    'btn.install': 'Kur',
    'btn.remove': 'Kaldır',

    'claude.title': 'Claude entegrasyonu',
    'claude.desc': 'Claude Code oturumları kenar çubuğunda <b>durumuyla</b> '
        + '(çalışıyor · onay bekliyor · bitti) ve <b>model, hesap ve kullanım çubuklarıyla</b> görünür. '
        + '<code>~/.claude/settings.json</code> içindeki kancaları ve <code>statusLine</code> ayarını birlikte kurar, '
        + 'birlikte kaldırır. Diğer kancalara dokunmaz ve hâlihazırda kullandığınız <code>statusLine</code> '
        + '<b>olduğu gibi çalıştırılır</b>, yani orada gördüğünüz değişmez. '
        + 'Yazmadan önce aynı klasöre bir yedek bırakılır.',

    'codex.title': 'Codex entegrasyonu',
    'codex.desc': 'Codex oturumları kenar çubuğunda <b>durumuyla</b> '
        + '(çalışıyor · onay bekliyor · bitti · kesildi) ve <b>model, hesap ve kullanım çubuklarıyla</b> görünür. '
        + 'Kurduktan sonra Codex’i yeniden açın ve <code>/hooks</code> altında AgentDeck kancalarını '
        + 'gözden geçirip onaylayın.',

    'codex.disabled': 'Codex bu kancaları kapatmış — açmadan hiçbir şey gelmez: {events}. Codex’i açın, <code>/hooks</code> çalıştırın ve onaylayın.',

    'root.head': 'Çalışma klasörü profili',
    'root.intro': 'Yeni sekmelerin hep aynı klasörde açılması için özel bir profil oluşturur. '
        + 'Değişiklikler Tabby yeniden başlatıldıktan sonra geçerli olur.',
    'root.use.title': 'Çalışma klasörü profilini kullan',
    'root.use.desc': 'Açıp klasörü doldurun — profil oluşturulur ve varsayılan profil olur.',
    'root.name.title': 'Profil adı',
    'root.cwd.title': 'Çalışma klasörü',
    'root.cwd.desc': 'Boş bırakırsanız profil oluşturulmaz. Elle yazarken ters eğik çizgi kaçış tuzaklarına '
        + 'düşmemek için düz eğik çizgi kullanın (örn. D:/Project).',
    'root.browse': 'Gözat',
    'root.command.title': 'Komut',

    'diag.head': 'Sorun bildir',
    'diag.intro': 'Tanılama günlüklerini <b>tek bir zip dosyasında</b> toplar ve dosyanın bulunduğu klasörü açar. '
        + 'İçinde şunlar var: eklenti/Tabby sürümleri ve işletim sistemi, yukarıdaki ayarlar ve '
        + '<code>{path}</code> yolunun en son iki kuşağı. Günlüklerde <b>sekme başlıkları ve açtığınız '
        + 'dosya yolları</b> yer alır — göndermeden önce zip’i açıp kontrol edebilirsiniz.',
    'diag.screen.title': 'Ham ekran içeriğini de ekle',
    'diag.screen.desc': 'Çizim bozukluğu sorunlarında açın. Terminal ekranı olduğu gibi girer — '
        + 'çalışmanız ve kodunuz görünür — bu yüzden varsayılan olarak kapalıdır.',
    'diag.collect.title': 'Günlükleri topla',
    'diag.collect.desc': 'Eklenti v{version}.',
    'diag.made': 'Oluşturuldu: ',
    'diag.btn': 'Topla',

    'dev.head': 'Geliştirici seçenekleri',
    'dev.use.title': 'Geliştirici seçeneklerini etkinleştir',
    'dev.use.desc': '<b>Canlı yeniden yükleme</b>yi açar — <code>npm run build</code> '
        + '<code>dist/index.js</code> dosyasını yeniden yazdığında pencere, <b>oturumlarınız korunarak</b> '
        + 'yeni eklentiye geçer (sekmeler aynı pty’ye yeniden bağlanır). Kısayol sekmesindeki '
        + '<b>[dev] Eklentiyi yeniden yükle</b> de bu anahtarı izler. Kapalıyken dist değişse bile hiçbir şey olmaz. '
        + 'Yalnızca kaynak ağacından kurulumda görünür; npm sürümünde bu özellik yoktur.',
    'dev.now.title': 'Şimdi yeniden yükle',
    'dev.now.desc': 'Derlemeden, mevcut dist ile yeniden yükler.',
    'dev.btn': 'Yeniden yükle',

    'footer': 'Geri kalanlar — pencere oranı, kenar çubuğu genişliği, saydamlık, durum algılama, giriş işleme — '
        + 'varsayılan değerlere sabitlenmiştir. Birini değiştirmeniz gerekirse yapılandırma dosyasındaki '
        + '<code>agentDeck.*</code> değerlerini doğrudan düzenleyin. '
        + 'Kısayollar <b>Kısayollar</b> sekmesinde <code>agentdeck-*</code> olarak bulunur.',
}
