let parsedLyrics = [], generatedLyrics = [], rawLines = [], syncIndex = 0;
let mediaRecorder, chunks = [], currentBlob = null;
let recordingFPS = 30;
let streamRef = null;

// --- TOAST SYSTEM ---
function showToast(msg, isError = false) {
    const container = document.getElementById('toastContainer');
    const toast = document.createElement('div');
    toast.className = isError ? 'toast error' : 'toast';
    toast.innerText = msg;
    container.appendChild(toast);
    setTimeout(() => { toast.remove(); }, 4000);
}

// --- DATABASE (INDEXED DB) ---
const DB_NAME = 'AestheticStudioDB';
const DB_VERSION = 1;
let db;

const initDB = () => {
    return new Promise((resolve) => {
        const request = indexedDB.open(DB_NAME, DB_VERSION);
        request.onupgradeneeded = (e) => {
            const db = e.target.result;
            if (!db.objectStoreNames.contains('assets')) {
                db.createObjectStore('assets');
            }
        };
        request.onsuccess = (e) => {
            db = e.target.result;
            resolve(db);
        };
    });
};

const saveAsset = async (key, file) => {
    if(!db) await initDB();
    const tx = db.transaction('assets', 'readwrite');
    tx.objectStore('assets').put(file, key);
};

const getAsset = async (key) => {
    if(!db) await initDB();
    return new Promise((resolve) => {
        const tx = db.transaction('assets', 'readonly');
        const req = tx.objectStore('assets').get(key);
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => resolve(null);
    });
};

// --- DOM ELEMENTS ---
const els = {
    welcome: document.getElementById('welcomeScreen'),
    initial: document.getElementById('initialContent'),
    restoreMsg: document.getElementById('restoreStatus'),
    loader: document.getElementById('loadingSequence'),
    loadNum: document.getElementById('loadNum'),
    loadFill: document.getElementById('loadFill'),
    modal: document.getElementById('configModal'),
    recModal: document.getElementById('recModal'),
    exportModal: document.getElementById('exportModal'),
    paneUp: document.getElementById('paneUpload'),
    panePaste: document.getElementById('panePaste'),
    paneGen: document.getElementById('paneGenerate'),
    countdown: document.getElementById('countdownOverlay'),
    countNum: document.getElementById('countNum'),
    player: document.getElementById('playerView'),
    audio: document.getElementById('audioPlayer'),
    cd: document.getElementById('cdDisc'),
    lyricTxt: document.getElementById('lyricDisplay'),
    lab: document.getElementById('lyricLab'),
    labCur: document.getElementById('labCurrent'),
    labNext: document.getElementById('labNext'),
    dlBtn: document.getElementById('dlLrcBtn')
};

// --- INIT ---
window.onload = async () => {
    await initDB();
    const img = await getAsset('cover');
    const audio = await getAsset('audio');
    const lyrics = await getAsset('lyrics');
    
    if(img && audio && lyrics) {
        showToast("Session restored");
        if(img) { els.cd.style.backgroundImage = `url(${URL.createObjectURL(img)})`; document.getElementById('imgLabel').innerText = "✓ Cached Cover"; }
        if(audio) { els.audio.src = URL.createObjectURL(audio); document.getElementById('audioLabel').innerText = "✓ Cached Audio"; }
        if(lyrics) {
            if(typeof lyrics === 'string') parseLrc(lyrics);
            else parseLrc(await lyrics.text());
            document.getElementById('lrcLabel').innerText = "✓ Cached Lyrics";
        }
    }
};

document.getElementById('enterBtn').onclick = () => {
    els.initial.style.opacity = '0';
    setTimeout(() => {
        els.initial.style.display = 'none';
        els.loader.style.display = 'grid';
        runProgressBar();
    }, 500);
};

function runProgressBar() {
    let p = 0;
    const loop = () => {
        p += Math.random() > 0.5 ? Math.floor(Math.random()*2)+1 : 1;
        if(p>100)p=100;
        els.loadNum.innerText = p.toString().padStart(2,'0');
        els.loadFill.style.width = p+"%";
        if(p<100) setTimeout(loop, Math.random()>0.8?40:15);
        else setTimeout(() => {
            els.welcome.classList.add('fade-out');
            setTimeout(() => els.modal.classList.add('active'), 800);
        }, 500);
    };
    loop();
}

// --- FILES ---
const handleFile = (id, lbl, cb, dbKey) => document.getElementById(id).onchange = (e) => {
    const f = e.target.files[0];
    if(!f) return;
    document.getElementById(lbl).innerText = "✓ " + f.name.substring(0,20) + "...";
    if(dbKey) saveAsset(dbKey, f);
    const r = new FileReader();
    r.onload = ev => cb(ev.target.result, f);
    id === 'lrcInput' ? r.readAsText(f) : r.readAsDataURL(f);
};

handleFile('imageInput', 'imgLabel', res => els.cd.style.backgroundImage = `url(${res})`, 'cover');
document.getElementById('audioInput').onchange = (e) => {
    const f = e.target.files[0];
    if(!f) return;
    document.getElementById('audioLabel').innerText = "✓ " + f.name.substring(0,20) + "...";
    saveAsset('audio', f);
    els.audio.src = URL.createObjectURL(f);
};

function parseLrc(txt) {
    const regex = /\[(\d{2}):(\d{2}\.?\d*)\](.*)/;
    parsedLyrics = txt.split('\n').map(l => {
        const m = l.match(regex);
        return m ? { time: parseInt(m[1])*60 + parseFloat(m[2]), text: m[3].trim() } : null;
    }).filter(x => x);
    parsedLyrics.sort((a,b) => a.time - b.time);
    saveAsset('lyrics', txt);
}

handleFile('lrcInput', 'lrcLabel', (txt) => parseLrc(txt), 'lyrics');

const switchPane = (id) => {
    ['paneUpload','panePaste','paneGenerate'].forEach(p=>document.getElementById(p).style.display='none');
    document.querySelectorAll('.mode-btn').forEach(b=>b.classList.remove('active'));
    document.getElementById(id).style.display='block';
};
document.getElementById('modeUpload').onclick = (e) => { switchPane('paneUpload'); e.target.classList.add('active'); };
document.getElementById('modePaste').onclick = (e) => { switchPane('panePaste'); e.target.classList.add('active'); };
document.getElementById('modeGenerate').onclick = (e) => { switchPane('paneGenerate'); e.target.classList.add('active'); };

const launch = () => {
    if(!els.audio.src) return showToast("Audio file missing", true);
    els.modal.classList.remove('active'); els.modal.classList.add('hidden');
    setTimeout(() => {
        els.player.classList.add('active');
        document.getElementById('actions').classList.add('visible');
        els.audio.currentTime = 0; els.audio.play(); els.cd.classList.add('spinning');
    }, 500);
};
document.getElementById('launchBtnFile').onclick = launch;
document.getElementById('launchBtnPaste').onclick = () => {
    const txt = document.getElementById('pasteLrcArea').value;
    if(!txt) return showToast("Paste LRC text", true);
    parseLrc(txt); launch();
};

// --- LAB ---
document.getElementById('startSyncBtn').onclick = () => {
    if(!els.audio.src) return showToast("Upload audio first", true);
    const txt = document.getElementById('rawLyrics').value.trim();
    if(!txt) return showToast("Paste lyrics", true);
    rawLines = txt.split('\n').map(l => l.trim()).filter(l => l);
    syncIndex = 0; generatedLyrics = [];
    els.modal.classList.remove('active'); els.modal.classList.add('hidden');
    els.lab.classList.add('active');
    updateLabDisplay();
    setTimeout(() => els.audio.play(), 1000);
};

function updateLabDisplay() {
    if(syncIndex < rawLines.length) {
        els.labCur.innerText = rawLines[syncIndex];
        els.labNext.innerText = "Next: " + (rawLines[syncIndex+1] || "(End)");
    } else { els.labCur.innerText = "DONE!"; els.labNext.innerText = "Generating..."; }
}

const recordTimestamp = () => {
    if(syncIndex >= rawLines.length) return finishGen();
    generatedLyrics.push({ time: els.audio.currentTime, text: rawLines[syncIndex] });
    const btn = document.getElementById('tapSyncBtn');
    btn.classList.remove('pulse'); void btn.offsetWidth; btn.classList.add('pulse');
    syncIndex++;
    if(syncIndex >= rawLines.length) finishGen(); else updateLabDisplay();
};
document.body.onkeyup = (e) => { if(els.lab.classList.contains('active') && e.code === 'Space') recordTimestamp(); };
document.getElementById('tapSyncBtn').onclick = recordTimestamp;

function finishGen() {
    els.audio.pause(); parsedLyrics = [...generatedLyrics];
    let lrcContent = "";
    generatedLyrics.forEach(line => {
        const m = Math.floor(line.time / 60).toString().padStart(2,'0');
        const s = (line.time % 60).toFixed(2).padStart(5,'0');
        lrcContent += `[${m}:${s}]${line.text}\n`;
    });
    saveAsset('lyrics', lrcContent);
    const blob = new Blob([lrcContent], {type: 'text/plain'});
    els.dlBtn.onclick = () => {
        const a = document.createElement('a'); a.href = URL.createObjectURL(blob);
        a.download = 'synced_lyrics.lrc'; a.click();
    };
    els.dlBtn.style.display = 'block';
    els.lab.classList.remove('active'); launch();
}

// --- RECORDER (Enhanced) ---
document.getElementById('recordBtn').onclick = () => { els.recModal.style.display = 'grid'; };
document.querySelectorAll('.rec-opt').forEach(btn => {
    btn.onclick = () => {
        document.querySelectorAll('.rec-opt').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        recordingFPS = parseInt(btn.dataset.fps);
    };
});
document.getElementById('cancelRecBtn').onclick = () => els.recModal.style.display = 'none';

document.getElementById('startRecSequenceBtn').onclick = async () => {
    els.recModal.style.display = 'none';
    showToast("Select 'Chrome Tab' then 'Aesthetic Studio'");
    
    try {
        const stream = await navigator.mediaDevices.getDisplayMedia({
            video: { 
                width: 1920,
                height: 1080,
                frameRate: recordingFPS,
                cursor: "never"
            },
            audio: { echoCancellation: false },
            // THIS FIXES THE MISSING TAB ISSUE:
            selfBrowserSurface: "include",
            preferCurrentTab: true
        });
        
        streamRef = stream;
        const audioStream = els.audio.captureStream();
        const mixedStream = new MediaStream([...stream.getVideoTracks(), ...audioStream.getAudioTracks()]);
        
        mediaRecorder = new MediaRecorder(mixedStream, { 
            mimeType: 'video/webm; codecs=vp9',
            videoBitsPerSecond: 8000000 
        });
        
        chunks = [];
        mediaRecorder.ondataavailable = e => { if(e.data.size > 0) chunks.push(e.data); };
        
        mediaRecorder.onstop = () => {
            currentBlob = new Blob(chunks, { type: 'video/webm' });
            streamRef.getTracks().forEach(t => t.stop());
            document.body.classList.remove('recording-mode');
            els.exportModal.style.display = 'grid';
        };
        
        // Start Countdown
        els.countdown.style.display = 'grid';
        let count = 3;
        els.countNum.innerText = count;
        const timer = setInterval(() => {
            count--;
            if(count > 0) {
                els.countNum.innerText = count;
            } else {
                clearInterval(timer);
                els.countdown.style.display = 'none';
                document.body.classList.add('recording-mode');
                els.audio.currentTime = 0; 
                els.audio.play();
                mediaRecorder.start();
            }
        }, 1000);
        
    } catch (err) {
        console.error(err);
        showToast("Recording cancelled", true);
    }
};

els.audio.onended = () => {
    if(mediaRecorder && mediaRecorder.state === "recording") mediaRecorder.stop();
};

// --- EXPORT (Smart Fallback) ---
const downloadLocally = () => {
    if(!currentBlob) return;
    const a = document.createElement('a');
    a.href = URL.createObjectURL(currentBlob);
    a.download = `aesthetic_studio_${Date.now()}.webm`;
    a.click();
    showToast("Downloaded successfully");
};

document.getElementById('downloadLocalBtn').onclick = downloadLocally;

document.getElementById('generateQRBtn').onclick = () => {
    if(!currentBlob) return;
    const qrArea = document.getElementById('qrArea');
    const qrStatus = document.getElementById('qrStatus');
    const qrPlaceholder = document.getElementById('qrPlaceholder');
    
    qrArea.style.display = 'block';
    qrPlaceholder.innerHTML = ''; 
    qrStatus.innerText = "Uploading to temporary cloud...";
    
    const formData = new FormData();
    formData.append('file', currentBlob);
    
    // Attempt Upload
    fetch('https://file.io/?expires=1d', { method: 'POST', body: formData })
    .then(res => res.json())
    .then(data => {
        if(data.success) {
            qrStatus.innerText = "Scan to download";
            new QRCode(qrPlaceholder, { text: data.link, width: 128, height: 128 });
        } else {
            // Force fallback if server rejects
            throw new Error("Upload Rejected");
        }
    })
    .catch(err => {
        // SMART FALLBACK
        qrStatus.innerText = "Offline Mode: Downloading file...";
        showToast("Cloud unavailable. Downloading locally.", true);
        setTimeout(downloadLocally, 1500);
    });
};

document.getElementById('closeExportBtn').onclick = () => els.exportModal.style.display = 'none';

// --- SYNC ---
els.audio.ontimeupdate = () => {
    const active = [...parsedLyrics].reverse().find(l => els.audio.currentTime >= l.time);
    if (active && els.lyricTxt.innerText !== active.text) {
        els.lyricTxt.style.opacity = '0';
        setTimeout(() => { els.lyricTxt.innerText = active.text; els.lyricTxt.style.opacity = '1'; }, 100);
    }
};

document.getElementById('resetBtn').onclick = () => {
    els.audio.pause(); els.audio.currentTime = 0;
    els.cd.classList.remove('spinning'); els.player.classList.remove('active');
    document.getElementById('actions').classList.remove('visible');
    els.lyricTxt.innerText = "";
    setTimeout(() => { els.modal.classList.remove('hidden'); els.modal.classList.add('active'); }, 500);
};