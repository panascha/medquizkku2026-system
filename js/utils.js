// Utils Logic

function getDrivePreviewUrl(url) {
    if (!url || typeof url !== 'string' || url.trim() === "") return null;

    // รองรับทั้ง /file/d/ID/view และ ?id=ID และ /open?id=ID
    const patterns = [
        /\/file\/d\/([-\w]{25,})/,
        /[?&]id=([-\w]{25,})/,
    ];

    for (const pattern of patterns) {
        const match = url.match(pattern);
        if (match) {
            return `https://drive.google.com/file/d/${match[1]}/preview`;
        }
    }

    return null;
}

// ตัวอย่างการใช้งานใน Checking.html:
// document.getElementById('mainDocPreview').src = getDrivePreviewUrl(team.slipUrl);


function formatDate(dateStr) {
    if (!dateStr) return "—";
    const d = new Date(dateStr);
    if (isNaN(d)) return dateStr;
    return d.toLocaleDateString('th-TH', { year: 'numeric', month: 'short', day: 'numeric' });
}

function formatTime(timeStr) {
    if (!timeStr) return "—";
    if (typeof timeStr === 'string' && /^\d{2}:\d{2}(:\d{2})?$/.test(timeStr.trim())) {
        return timeStr.trim().slice(0, 5) + " น.";
    }
    const d = new Date(timeStr);
    if (isNaN(d)) return timeStr;
    const timeFormatted = d.toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' });
    return timeFormatted + " น.";
}