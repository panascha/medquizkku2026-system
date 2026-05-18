// Utils Logic

function getDrivePreviewUrl(url) {
    if (!url || url.trim() === "") return null;

    const match = url.match(/[-\w]{25,}/);
    if (!match) return url;

    const fileId = match[0];

    // ใช้ URL สำหรับ Embed โดยเฉพาะ ซึ่งมักจะข้ามขีดจำกัด CSP ได้ดีกว่า
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