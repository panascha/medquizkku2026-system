// Utils Logic

function getDrivePreviewUrl(url) {
    if (!url) return null;

    const match = url.match(/id=([^&]+)/) || url.match(/\/d\/([a-zA-Z0-9-_]+)/);
    if (!match) return url;

    const fileId = match[1];
    // ใช้ /preview เสมอ → Google จัดการ auth เองผ่าน iframe
    return `https://drive.google.com/file/d/${fileId}/preview`;
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