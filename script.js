// --- APP LOGIC ---
let parsedLyrics = [], generatedLyrics = [], rawLines = [], syncIndex = 0;
let mediaRecorder, chunks = [], currentBlob = null;
let recordingFPS = 60; 
let streamRef = null;
let isAutoFading = false; 

// --- WEB AUDIO API VARIABLES ---
let audioCtx, gainNode, audioSource, recDest;

// --- TOAST SYSTEM ---
function showToast(msg, isError = false) {
    const container = document.getElementById('toastContainer');
    const toast = document.createElement('div');
    toast.className = isError ? 'toast error' : 'toast';
    toast.innerText = msg;
    container.appendChild(toast);
    setTimeout(() => { toast.remove(); }, 4000);
}

// --- DATABASE ---
const DB_NAME = 'AestheticStudioDB';
const DB_VERSION = 2; 
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
    bgLayer: document.getElementById('customBg'),
    lyricTxt: document.getElementById('lyricDisplay'),
    songMeta: document.getElementById('songMeta'),
    titleInput: document.getElementById('titleInput'),
    artistInput: document.getElementById('artistInput'),
    wmInput: document.getElementById('wmInput'),
    caseWatermark: document.getElementById('caseWatermark'),
    lab: document.getElementById('lyricLab'),
    labCur: document.getElementById('labCurrent'),
    labNext: document.getElementById('labNext'),
    dlBtn: document.getElementById('dlLrcBtn')
};

// --- INITIALIZE AUDIO ENGINE ---
function initAudioSystem() {
    if (audioCtx) return; 
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    audioCtx = new AudioContext();
    gainNode = audioCtx.createGain();
    recDest = audioCtx.createMediaStreamDestination(); 
    audioSource = audioCtx.createMediaElementSource(els.audio);
    
    // Connect Graph: Source -> Gain -> [Speakers & Recorder]
    audioSource.connect(gainNode);
    gainNode.connect(audioCtx.destination);
    gainNode.connect(recDest);
}

// --- INIT ---
window.onload = async () => {
    await initDB();
    const img = await getAsset('cover');
    const audio = await getAsset('audio');
    const lyrics = await getAsset('lyrics');
    const bg = await getAsset('background'); 
    
    // Load Meta Info
    const savedTitle = await getAsset('title');
    const savedArtist = await getAsset('artist');
    const savedWm = await getAsset('watermark');
    
    if(savedTitle) els.titleInput.value = savedTitle;
    if(savedArtist) els.artistInput.value = savedArtist;
    if(savedWm) els.wmInput.value = savedWm;

    updateSongMeta(); 
    if(savedWm) els.caseWatermark.innerText = savedWm;
    
    if(img || audio || lyrics || bg) {
        showToast("Session restored");
        if(img) { els.cd.style.backgroundImage = `url(${URL.createObjectURL(img)})`; document.getElementById('imgLabel').innerText = "✓ Cached Cover"; }
        if(audio) { els.audio.src = URL.createObjectURL(audio); document.getElementById('audioLabel').innerText = "✓ Cached Audio"; }
        if(bg) { 
            const bgUrl = URL.createObjectURL(bg);
            els.bgLayer.style.backgroundImage = `url(${bgUrl})`; 
            els.bgLayer.classList.add('active');
            document.getElementById('bgLabel').innerText = "✓ Cached BG"; 
        }
        if(lyrics) {
            if(typeof lyrics === 'string') parseLrc(lyrics);
            else parseLrc(await lyrics.text());
            document.getElementById('lrcLabel').innerText = "✓ Cached Lyrics";
        }
    }
};

document.getElementById('enterBtn').onclick = () => {
    initAudioSystem();
    if(audioCtx && audioCtx.state === 'suspended') audioCtx.resume();

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

// --- TAB SWITCHING ---
document.querySelectorAll('.config-tab').forEach(btn => {
    btn.addEventListener('click', () => {
        document.querySelectorAll('.config-tab').forEach(b => b.classList.remove('active'));
        document.querySelectorAll('.config-pane').forEach(p => p.classList.remove('active'));
        btn.classList.add('active');
        document.getElementById(btn.dataset.tab).classList.add('active');
    });
});

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
handleFile('bgInput', 'bgLabel', res => {
    els.bgLayer.style.backgroundImage = `url(${res})`;
    els.bgLayer.classList.add('active');
}, 'background');

document.getElementById('audioInput').onchange = (e) => {
    const f = e.target.files[0];
    if(!f) return;
    document.getElementById('audioLabel').innerText = "✓ " + f.name.substring(0,20) + "...";
    saveAsset('audio', f);
    els.audio.src = URL.createObjectURL(f);
};

// --- META INFO UPDATER ---
function updateSongMeta() {
    const t = els.titleInput.value || "Track Title";
    const a = els.artistInput.value || "Artist Name";
    els.songMeta.innerHTML = `<b>${t}</b> • <span>${a}</span>`;
    saveAsset('title', els.titleInput.value);
    saveAsset('artist', els.artistInput.value);
}
els.titleInput.addEventListener('input', updateSongMeta);
els.artistInput.addEventListener('input', updateSongMeta);

if(els.wmInput) {
    els.wmInput.addEventListener('input', (e) => {
        els.caseWatermark.innerText = e.target.value;
        saveAsset('watermark', e.target.value);
    });
}

// --- FADE OUT & PAUSE ---
let isFading = false;
function fadeOutAndPause(callback) {
    if(isFading || !audioCtx) return;
    isFading = true;
    
    const currentTime = audioCtx.currentTime;
    gainNode.gain.cancelScheduledValues(currentTime);
    gainNode.gain.setValueAtTime(gainNode.gain.value, currentTime);
    gainNode.gain.linearRampToValueAtTime(0, currentTime + 1); 

    setTimeout(() => {
        els.audio.pause();
        els.cd.classList.add('paused');
        gainNode.gain.setValueAtTime(1, audioCtx.currentTime);
        isFading = false;
        if(callback) callback();
    }, 1000);
}

function resumeAudio() {
    if(!audioCtx) initAudioSystem();
    if(audioCtx.state === 'suspended') audioCtx.resume();
    
    isAutoFading = false; 
    gainNode.gain.cancelScheduledValues(audioCtx.currentTime);
    gainNode.gain.setValueAtTime(1, audioCtx.currentTime); 
    
    els.audio.play();
    els.cd.classList.remove('paused');
}

function togglePlayback() {
    if (!els.player.classList.contains('active')) return;
    if (els.audio.paused) resumeAudio(); else fadeOutAndPause();
}

document.body.addEventListener('click', (e) => {
    if (e.target.closest('button, input, textarea, .modal, .bottom-actions')) return;
    togglePlayback();
});

document.addEventListener('keydown', (e) => {
    if (e.code === 'Space' && els.player.classList.contains('active') && !els.lab.classList.contains('active')) {
        e.preventDefault();
        togglePlayback();
    }
});

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
        resumeAudio();
        els.audio.currentTime = 0; 
        els.cd.classList.add('spinning');
    }, 500);
};
document.getElementById('launchBtnFile').onclick = launch;
document.getElementById('launchBtnPaste').onclick = () => {
    const txt = document.getElementById('pasteLrcArea').value;
    if(!txt) return showToast("Paste LRC text", true);
    parseLrc(txt); launch();
};

// --- UPDATED LYRIC LAB UI ---
document.getElementById('startSyncBtn').onclick = () => {
    if(!els.audio.src) return showToast("Upload audio first", true);
    const txt = document.getElementById('rawLyrics').value.trim();
    if(!txt) return showToast("Paste lyrics", true);
    
    // Inject New HTML Structure with Restart Button
    els.lab.innerHTML = `
        <div class="stamp-flash" id="stampFlash"></div>
        <div class="lab-progress-container">
            <div class="lab-status-text" id="labStatus">Line 0 / 0</div>
            <div class="lab-progress-track"><div class="lab-progress-fill" id="labFill"></div></div>
        </div>
        <div class="lab-display">
            <div class="lab-line prev" id="labPrev">...</div>
            <div class="lab-line current" id="labCur">Ready?</div>
            <div class="lab-line next" id="labNext">Next: ...</div>
        </div>
        <div class="lab-controls">
            <button id="restartSyncBtn" class="btn-sync-restart" title="Restart">↺</button>
            <button id="tapSyncBtn" class="btn-sync-tap">TAP to STAMP</button>
        </div>
    `;
    
    // Bind Actions
    document.getElementById('tapSyncBtn').onclick = recordTimestamp;
    document.getElementById('restartSyncBtn').onclick = () => {
        syncIndex = 0;
        generatedLyrics = [];
        els.audio.currentTime = 0;
        updateLabDisplay();
        resumeAudio();
        showToast("Restarted");
    };
    
    rawLines = txt.split('\n').map(l => l.trim()).filter(l => l);
    syncIndex = 0; generatedLyrics = [];
    els.modal.classList.remove('active'); els.modal.classList.add('hidden');
    els.lab.classList.add('active');
    
    updateLabDisplay();
    setTimeout(() => resumeAudio(), 1000);
};

function updateLabDisplay() {
    const status = document.getElementById('labStatus');
    const fill = document.getElementById('labFill');
    const prev = document.getElementById('labPrev');
    const cur = document.getElementById('labCur');
    const next = document.getElementById('labNext');
    const btn = document.getElementById('tapSyncBtn');

    if(syncIndex < rawLines.length) {
        status.innerText = `Line ${syncIndex + 1} / ${rawLines.length}`;
        fill.style.width = `${((syncIndex) / rawLines.length) * 100}%`;
        
        prev.innerText = rawLines[syncIndex - 1] || "...";
        cur.innerText = rawLines[syncIndex];
        next.innerText = rawLines[syncIndex + 1] || "(End)";
        
        btn.innerText = "TAP to STAMP";
    } else {
        status.innerText = "COMPLETE";
        fill.style.width = "100%";
        prev.innerText = rawLines[rawLines.length - 1];
        cur.innerText = "DONE!";
        next.innerText = "Saving...";
        btn.innerText = "FINISH";
    }
}

const recordTimestamp = () => {
    if(syncIndex >= rawLines.length) return finishGen();
    
    generatedLyrics.push({ time: els.audio.currentTime, text: rawLines[syncIndex] });
    
    // UI Feedback
    const btn = document.getElementById('tapSyncBtn');
    const flash = document.getElementById('stampFlash');
    
    if(btn) { btn.classList.remove('pulse'); void btn.offsetWidth; btn.classList.add('pulse'); }
    if(flash) { flash.classList.remove('active'); void flash.offsetWidth; flash.classList.add('active'); }
    
    syncIndex++;
    if(syncIndex >= rawLines.length) finishGen(); else updateLabDisplay();
};

// Keyboard shortcut
document.body.onkeyup = (e) => { if(els.lab.classList.contains('active') && e.code === 'Space') recordTimestamp(); };


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

// --- RECORDER LOGIC (FIXED) ---
const recBtn = document.getElementById('startRecSequenceBtn');

function resetRecModal() {
    recBtn.innerText = "1. Select Screen";
    recBtn.classList.remove('active-step-2');
    recBtn.onclick = setupStream;
}

document.getElementById('recordBtn').onclick = () => { 
    fadeOutAndPause(() => {
        els.audio.currentTime = 0; 
        els.recModal.style.display = 'grid'; 
        resetRecModal();
    });
};

document.querySelectorAll('.rec-opt').forEach(btn => {
    btn.onclick = () => {
        document.querySelectorAll('.rec-opt').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        recordingFPS = parseInt(btn.dataset.fps);
    };
});
document.getElementById('cancelRecBtn').onclick = () => {
    els.recModal.style.display = 'none';
    if(streamRef) { streamRef.getTracks().forEach(t => t.stop()); streamRef = null; }
};

// STEP 1: Get User Media
async function setupStream() {
    try {
        const stream = await navigator.mediaDevices.getDisplayMedia({
            video: { 
                width: { ideal: 1920 },
                height: { ideal: 1080 },
                frameRate: { ideal: recordingFPS }, 
                displaySurface: "browser"
            },
            audio: { echoCancellation: false, noiseSuppression: false },
            selfBrowserSurface: "include",
            preferCurrentTab: true
        });
        
        streamRef = stream;
        
        stream.getVideoTracks()[0].onended = () => {
            showToast("Screen selection cancelled");
            resetRecModal();
        };

        recBtn.innerText = "2. Start Recording";
        recBtn.classList.add('active-step-2');
        recBtn.onclick = startRecordingFlow;
        showToast("Screen locked. Press Start!", false);

    } catch (err) {
        console.error(err);
        showToast("Selection cancelled", true);
    }
}

// STEP 2: Fullscreen & Launch
async function startRecordingFlow() {
    try {
        if (document.documentElement.requestFullscreen) {
            await document.documentElement.requestFullscreen();
        }
    } catch(e) { console.warn("Fullscreen failed", e); }

    els.recModal.style.display = 'none';
    isAutoFading = false; 
    
    const videoTracks = streamRef.getVideoTracks();
    const audioTracks = recDest.stream.getAudioTracks(); 
    const mixedStream = new MediaStream([...videoTracks, ...audioTracks]);
    
    const mime = MediaRecorder.isTypeSupported("video/webm;codecs=h264") 
        ? "video/webm;codecs=h264" 
        : "video/webm";

    mediaRecorder = new MediaRecorder(mixedStream, { 
        mimeType: mime,
        videoBitsPerSecond: 12000000 
    });
    
    chunks = [];
    mediaRecorder.ondataavailable = e => { if(e.data.size > 0) chunks.push(e.data); };
    
    mediaRecorder.onstop = () => {
        currentBlob = new Blob(chunks, { type: 'video/webm' });
        if(streamRef) streamRef.getTracks().forEach(t => t.stop());
        document.body.classList.remove('recording-mode');
        if (document.fullscreenElement) document.exitFullscreen();
        els.exportModal.style.display = 'grid';
    };
    
    els.countdown.style.display = 'grid';
    els.audio.currentTime = 0; 
    let count = 3;
    els.countNum.innerText = count;
    
    const timer = setInterval(() => {
        count--;
        if(count > 0) {
            els.countNum.innerText = count;
        } else {
            clearInterval(timer);
            
            // 1. Hide Visuals
            els.countdown.style.display = 'none';
            document.body.classList.add('recording-mode');
            
            // 2. TIMING FIX: Wait 100ms for repainting "1" away
            setTimeout(() => {
                // 3. Start Recording
                mediaRecorder.start();
                
                // 4. Pre-roll 800ms
                setTimeout(() => {
                    els.audio.currentTime = 0;
                    resumeAudio();
                    els.cd.classList.add('spinning');
                }, 800);
            }, 100); 
        }
    }, 1000);
}

els.audio.onended = () => {
    if(mediaRecorder && mediaRecorder.state === "recording") {
        setTimeout(() => mediaRecorder.stop(), 1000); 
    }
};

// --- EXPORT LOGIC (Local + Free Cloud) ---
const downloadLocally = () => {
    if(!currentBlob) return;
    const a = document.createElement('a');
    a.href = URL.createObjectURL(currentBlob);
    a.download = `aesthetic_studio_${Date.now()}.mp4`;
    a.click();
    showToast("Downloaded MP4 file");
};
document.getElementById('downloadLocalBtn').onclick = downloadLocally;

// LITTERBOX API INTEGRATION (Truly Free, No Account)
document.getElementById('generateQRBtn').onclick = () => {
    if(!currentBlob) return showToast("No recording found", true);
    
    const qrArea = document.getElementById('qrArea');
    const qrStatus = document.getElementById('qrStatus');
    const qrPlaceholder = document.getElementById('qrPlaceholder');
    qrArea.style.display = 'block';
    qrPlaceholder.innerHTML = ''; 
    qrStatus.innerText = "Uploading to Cloud (1h expiry)...";

    // Prepare FormData for Litterbox
    const formData = new FormData();
    formData.append("reqtype", "fileupload");
    formData.append("time", "1h"); // 1 hour duration
    formData.append("fileToUpload", currentBlob, "video.mp4");

    fetch("https://litterbox.catbox.moe/resources/internals/api.php", {
        method: "POST",
        body: formData
    })
    .then(response => {
        if (!response.ok) throw new Error("Upload Failed");
        return response.text();
    })
    .then(url => {
        if (url.startsWith("https")) {
            qrStatus.innerText = "Scan to Download";
            new QRCode(qrPlaceholder, { text: url, width: 128, height: 128 });
        } else {
            throw new Error("Invalid Response");
        }
    })
    .catch(err => {
        console.error(err);
        qrStatus.innerText = "Upload Failed. Downloading locally.";
        showToast("Cloud Error. Using local download.", true);
        setTimeout(downloadLocally, 1500);
    });
};

document.getElementById('closeExportBtn').onclick = () => els.exportModal.style.display = 'none';

// --- SYNC & AUTO-FADE ENGINE ---
els.audio.ontimeupdate = () => {
    const active = [...parsedLyrics].reverse().find(l => els.audio.currentTime >= l.time);
    
    if (active && els.lyricTxt.innerText !== active.text) {
        els.lyricTxt.style.opacity = '0';
        setTimeout(() => { 
            els.lyricTxt.innerText = active.text; 
            els.lyricTxt.style.opacity = '1'; 
        }, 100);
    }

    if(mediaRecorder && mediaRecorder.state === 'recording' && !isAutoFading && els.audio.duration > 0) {
        const timeLeft = els.audio.duration - els.audio.currentTime;
        if(timeLeft < 1.5) { 
            isAutoFading = true;
            console.log("Auto-fading audio...");
            const t = audioCtx.currentTime;
            gainNode.gain.cancelScheduledValues(t);
            gainNode.gain.setValueAtTime(gainNode.gain.value, t);
            gainNode.gain.linearRampToValueAtTime(0, t + 1.5); 
        }
    }
};

document.getElementById('resetBtn').onclick = () => {
    fadeOutAndPause(() => {
        els.audio.currentTime = 0;
        els.cd.classList.remove('spinning'); 
        els.player.classList.remove('active');
        document.getElementById('actions').classList.remove('visible');
        els.lyricTxt.innerText = "";
        setTimeout(() => { els.modal.classList.remove('hidden'); els.modal.classList.add('active'); }, 500);
    });
};