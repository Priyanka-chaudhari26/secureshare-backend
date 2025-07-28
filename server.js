import express from "express";
import nodemailer from "nodemailer";
import cors from "cors";
import bodyParser from "body-parser";
import dotenv from "dotenv";
import admin from "firebase-admin";
import path from "path";
import { fileURLToPath } from "url";
import fs from "fs";
import { randomBytes } from "crypto";


dotenv.config();

const app = express();
// app.use(cors());
app.use(cors({
  origin:'*',
  exposedHeaders: ["Content-Disposition"]
}));

app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));


const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const serviceAccount = JSON.parse(
  fs.readFileSync(path.join(__dirname, "serviceAccountKey.json"), "utf8")
);

admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
    databaseURL: process.env.FIREBASE_DB_URL
});
const db = admin.database();

// Setup Nodemailer transporter
const transporter = nodemailer.createTransport({
    service: "gmail",
    auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS
    }
});

app.post("/send-otp", async (req, res) => {
    const { email, uid } = req.body;

    if (!email || !uid) return res.status(400).json({ error: "Email and UID are required" });

    // Generate random 6-digit OTP
    const otp = Math.floor(100000 + Math.random() * 900000).toString();

    try {
        // Save OTP in Firebase under user's UID
        await db.ref(`users/${uid}`).update({
            otp,
            otpExpiresAt: Date.now() + 10 * 60 * 1000, // 10 minutes
            isVerified: false
        });

        // Send email
        await transporter.sendMail({
            from: process.env.EMAIL_USER,
            to: email,
            subject: "Your Secure Share OTP",
            text: `Your OTP is: ${otp}. It will expire in 10 minutes.`
        });
        console.log("otp sent",otp)
        res.json({ message: "OTP sent successfully!" });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: "Failed to send OTP" });
    }
});
// app.post("/verify-otp", async (req, res) => {
//     const { email, otp } = req.body;

//     if (!email || !otp) {
//         return res.status(400).json({ error: "Email and OTP are required" });
//     }

//     try {
//         // const encodedEmail = Buffer.from(email).toString("base64");
//         const userSnapshot = await db.ref(`users`).once("value");
//         // const userSnapshot = await db.ref(`users/${encodedEmail}`).once("value");

//         if (!userSnapshot.exists()) {
//             return res.status(404).json({ error: "User not found" });
//         }

//         const userData = userSnapshot.val();

//         if (userData.otp !== otp) {
//             return res.status(400).json({ error: "Invalid OTP" });
//         }

//         if (Date.now() > userData.otpExpiresAt) {
//             return res.status(400).json({ error: "OTP has expired" });
//         }

//         // Update user as verified
//         await db.ref(`users/${encodedEmail}`).update({
//             isVerified: true
//         });

//         res.json({ success: true, message: "OTP verified successfully" });
//     } catch (err) {
//         console.error(err);
//         res.status(500).json({ error: "Failed to verify OTP" });
//     }
// });
app.post("/verify-otp", async (req, res) => {
    const { email, otp } = req.body;

    if (!email || !otp) {
        return res.status(400).json({ error: "Email and OTP are required" });
    }

    try {
        const usersSnapshot = await db.ref(`users`).once("value");

        if (!usersSnapshot.exists()) {
            return res.status(404).json({ error: "No users found" });
        }

        const users = usersSnapshot.val();
        let userId = null;
        let userData = null;

        // 🔎 Search for user with matching email
        Object.keys(users).forEach(uid => {
            if (users[uid].email === email) {
                userId = uid;
                userData = users[uid];
            }
        });

        if (!userData) {
            return res.status(404).json({ error: "User not found" });
        }

        if (userData.otp !== otp) {
            return res.status(400).json({ error: "Invalid OTP" });
        }

        if (Date.now() > userData.otpExpiresAt) {
            return res.status(400).json({ error: "OTP has expired" });
        }

        await db.ref(`users/${userId}`).update({
            isVerified: true
        });

        res.json({ success: true, message: "OTP verified successfully" });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: "Failed to verify OTP" });
    }
});

app.post("/share-file", async (req, res) => {
    console.log("Running share file")
    const { ownerUid, fileKey, recipientEmail, password, expiresAt } = req.body;
    console.log("ownerUid:",ownerUid)
    console.log("fileKey:",fileKey)
    console.log("recipientEmail:",recipientEmail)
    console.log("password:",password)
    if (!ownerUid || !fileKey || !recipientEmail || !password) {
        return res.status(400).json({ error: "Missing required fields" });
    }

    try {
        const shareID = randomBytes(8).toString("hex");

        const shareLink = `http://localhost:5500/share.html?sid=${shareID}&emailRequired=true`; // Adjust domain if deployed
        console.log("shareLink",shareLink)
        // Save share info in Firebase
        const shareData = {
            link: shareLink,
            password,
            expiresAt: expiresAt || null,
            recipientEmail,
            createdAt: Date.now()
        };

        await db.ref(`users/${ownerUid}/files/${fileKey}/shares/${shareID}`).set(shareData);

        // Send email with link, password and expiry
        await transporter.sendMail({
            from: process.env.EMAIL_USER,
            to: recipientEmail,
            subject: "A file has been shared with you securely",
            text: `
    Hello,

    A file has been securely shared with you.

    Link: ${shareLink}
    Password: ${password}
    Expiry: ${expiresAt ? new Date(expiresAt).toLocaleString() : "No expiry"}

    Please use the above link and password to access the file. Do not share this link and password to anyone.

        - SecureShare Team
            `
        });

    res.json({ success: true, message: `File shared successfully!,shared link is: ${shareLink}` ,shareLink:shareLink});
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: "Failed to share file" });
    }
});
// app.post("/access-file", async (req, res) => {
//     const { sid, recipientEmail, password,emailRequired = false } = req.body;
//     console.log("BODY:", req.body);

//     if (!sid || !password) {
//         return res.status(400).json({ error: "Password required." });
//     }

//     if (emailRequired && !recipientEmail) {
//         return res.status(400).json({ error: "Recipient email is required." });
//     }
   

//     try {
//         const usersSnapshot = await db.ref(`users`).once("value");
//         let fileData = null;

//         // Find the file by share ID
//         Object.keys(usersSnapshot.val()).forEach(uid => {
//             const userFiles = usersSnapshot.val()[uid].files || {};
//             Object.keys(userFiles).forEach(fileKey => {
//                 const shares = userFiles[fileKey].shares || {};
//                 if (shares[sid]) {
//                     fileData = { ...shares[sid], ownerUid: uid, fileKey, fileContent: userFiles[fileKey].content, fileName: userFiles[fileKey].name };
//                 }
//             });
//         });

//         if (!fileData) {
//             return res.status(404).json({ error: "Invalid or expired link." });
//         }

//         if (emailRequired && fileData.recipientEmail && fileData.recipientEmail !== recipientEmail) {
//             return res.status(403).json({ error: "Access denied. Email mismatch." });
//         }

//         console.log("emailRequired:", emailRequired, "recipientEmail:", recipientEmail);
//         console.log("fileData.recipientEmail:", fileData.recipientEmail);
//         if (fileData.password !== password) {
//             return res.status(401).json({ error: "Invalid password." });
//         }

//         if (fileData.expiresAt && Date.now() > fileData.expiresAt) {
//             return res.status(410).json({ error: "This link has expired." });
//         }
//         let base64Content = fileData.fileContent.trim();

//         if (base64Content.startsWith("data:")) {
//         base64Content = base64Content.split(";base64,").pop();
//         }
//         let buffer;
//         try {
//             // Try base64 decode
//             buffer = Buffer.from(base64Content, "base64");

//             // Heuristic: If decoded buffer looks too small, fallback
//             if (buffer.length < 10) throw new Error("Base64 decode fallback");
//         } catch (decodeErr) {
//             console.warn("Base64 decoding failed or unnecessary, using raw buffer");
//             buffer = Buffer.from(fileData.fileContent);
//         }


//         res.setHeader("Content-Disposition", `attachment; filename="${fileData.fileName}"`);
//         // res.setHeader("Content-Type", "application/octet-stream");
//         let mimeType = "application/octet-stream"; // default
//         if (fileData.fileName.endsWith(".png")) mimeType = "image/png";
//         else if (fileData.fileName.endsWith(".jpg") || fileData.fileName.endsWith(".jpeg")) mimeType = "image/jpeg";
//         else if (fileData.fileName.endsWith(".pdf")) mimeType = "application/pdf";

//         res.setHeader("Content-Type", mimeType);

//         console.log("Buffer size:", buffer.length);

//         res.send(buffer);

//     } catch (err) {
//         console.error(err);
//         res.status(500).json({ error: "Failed to access file." });
//     }
// });
app.post("/access-file", async (req, res) => {
    const { sid, recipientEmail, password, emailRequired = false } = req.body;
    console.log("BODY:", req.body);

    if (!sid || !password) {
        return res.status(400).json({ error: "Password required." });
    }

    if (emailRequired && !recipientEmail) {
        return res.status(400).json({ error: "Recipient email is required." });
    }

    try {
        const usersSnapshot = await db.ref(`users`).once("value");
        let fileData = null;

        // Find the file by share ID
        Object.keys(usersSnapshot.val()).forEach(uid => {
            const userFiles = usersSnapshot.val()[uid].files || {};
            Object.keys(userFiles).forEach(fileKey => {
                const shares = userFiles[fileKey].shares || {};
                if (shares[sid]) {
                    fileData = { ...shares[sid], ownerUid: uid, fileKey, fileContent: userFiles[fileKey].content, fileName: userFiles[fileKey].name };
                }
            });
        });

        if (!fileData) {
            return res.status(404).json({ error: "Invalid or expired link." });
        }

        if (emailRequired && fileData.recipientEmail && fileData.recipientEmail !== recipientEmail) {
            return res.status(403).json({ error: "Access denied. Email mismatch." });
        }

        if (fileData.password !== password) {
            return res.status(401).json({ error: "Invalid password." });
        }

        if (fileData.expiresAt && Date.now() > fileData.expiresAt) {
            return res.status(410).json({ error: "This link has expired." });
        }

        let base64Content = fileData.fileContent.trim();

        if (base64Content.startsWith("data:")) {
            base64Content = base64Content.split(";base64,").pop();
        }

        let buffer;
        try {
            // Try base64 decode
            buffer = Buffer.from(base64Content, "base64");
            if (buffer.length < 10) throw new Error("Base64 decode fallback");
        } catch (decodeErr) {
            console.warn("Base64 decoding failed or unnecessary, using raw buffer");
            buffer = Buffer.from(fileData.fileContent);
        }

        res.setHeader("Content-Disposition", `attachment; filename="${fileData.fileName}"`);
        let mimeType = "application/octet-stream"; // default
        if (fileData.fileName.endsWith(".png")) mimeType = "image/png";
        else if (fileData.fileName.endsWith(".jpg") || fileData.fileName.endsWith(".jpeg")) mimeType = "image/jpeg";
        else if (fileData.fileName.endsWith(".pdf")) mimeType = "application/pdf";

        res.setHeader("Content-Type", mimeType);
        console.log("buffer",buffer);
        console.log("fileName",fileData.fileName)
        console.log("Buffer size:", buffer.length);

        res.send(buffer);

    } catch (err) {
        console.error(err);
        res.status(500).json({ error: "Failed to access file." });
    }
});

app.post("/generate-link", async (req, res) => {
    const { ownerUid, fileKey, password, expiresAt } = req.body;

    if (!ownerUid || !fileKey || !password) {
        return res.status(400).json({ error: "Missing required fields" });
    }

    try {
        const shareID = randomBytes(8).toString("hex");

        const shareLink = `http://localhost:5500/share.html?sid=${shareID}`;

        // Save share info in Firebase
        const shareData = {
            link: shareLink,
            password,
            expiresAt: expiresAt || null,
            recipientEmail: null, // Public link
            createdAt: Date.now()
        };

        await db.ref(`users/${ownerUid}/files/${fileKey}/shares/${shareID}`).set(shareData);

        res.json({
            success: true,
            message: "Public link generated successfully!",
            link: shareLink,
            password
        });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: "Failed to generate public link" });
    }
});

app.listen(5000, () => {
    console.log("Backend running on http://localhost:5000");
});
