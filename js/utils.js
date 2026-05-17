// Utils Logic

function getDrivePreviewUrl(url) {
    if (!url) return null;

    // ดึง File ID จาก URL รูปแบบต่างๆ ของ Google Drive
    const match = url.match(/id=([^&]+)/) || url.match(/\/d\/([a-zA-Z0-9-_]+)(?:\/|$)/);
    if (!match) return url; // ถ้าดึง ID ไม่ได้ ให้คืนค่า URL เดิมกลับไป

    const fileId = match[1];

    const extMatch = url.match(/\.([a-zA-Z0-9]+)(?:[?#]|$)/);
    const ext = extMatch ? extMatch[1].toLowerCase() : null;

    const imageExts = new Set(['jpg','jpeg','png','gif','webp','bmp','svg','tiff']);
    if (ext && imageExts.has(ext)) {
        // thumbnail endpoint is fast for images
        return `https://drive.google.com/thumbnail?id=${fileId}&sz=w1000`;
    }

    if (ext === 'pdf') {
        // preview works well for PDFs (embeddable viewer)
        return `https://drive.google.com/file/d/${fileId}/preview`;
    }

    // Fallback: try thumbnail first (works for many file types), else original URL
    return `https://drive.google.com/thumbnail?id=${fileId}&sz=w1000` || url;
}

// ตัวอย่างการใช้งานใน Checking.html:
// document.getElementById('mainDocPreview').src = getDrivePreviewUrl(team.slipUrl);


function formatDate(dateStr) {
    if (!dateStr) return "—";
    const d = new Date(dateStr);
    return isNaN(d) ? dateStr : d.toLocaleDateString('th-TH');
}

function formatTime(timeStr) {
    if (!timeStr) return "—";
    const d = new Date(timeStr);
    return isNaN(d) ? timeStr : d.toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' });
}