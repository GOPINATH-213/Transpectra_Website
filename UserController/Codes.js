const db = require("../Database/FirebaseConfig");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const { generateAndSendReport } = require("../sendReports");
const multer = require("multer");
const path = require("path");
const { GoogleGenerativeAI } = require("@google/generative-ai");
require("dotenv").config();
const SECRET_KEY = process.env.SECRET_KEY;
const hbs = require("hbs");
const cloudinary = require("../cloudinary");
const fs = require("fs");
const { v4: uuidv4 } = require("uuid");

hbs.registerHelper("formatDate", function (timestamp) {
  if (!timestamp || !timestamp.toDate) return "";
  const date = timestamp.toDate();
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  const dd = String(date.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
});

const UPLOAD_DIR = path.join(__dirname, "uploads");
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR);

const storage = multer.diskStorage({
  destination: (_, __, cb) => cb(null, UPLOAD_DIR),
  filename: (_, file, cb) =>
    cb(null, `${Date.now()}-${file.originalname.replace(/\s+/g, "_")}`),
});
const upload = multer({ storage, limits: { fileSize: 12 * 1024 * 1024 } });

// Gemini client
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

function stripAmPm(timeStr) {
  if (!timeStr) return "";

  // Match "hh:mm AM/PM" or "hh:mm"
  const match = timeStr.match(/(\d{1,2}):(\d{2})(?:\s?[AaPp][Mm])?/);
  if (!match) return timeStr;

  let hours = parseInt(match[1], 10);
  let minutes = match[2];

  // If input had AM/PM, adjust into proper 12h without label
  const ampm = timeStr.toLowerCase().includes("pm");
  if (ampm && hours < 12) hours += 0; // keep as-is
  if (!ampm && hours === 12) hours = 12; // keep 12 as-is for AM case

  return `${String(hours).padStart(2, "0")}:${minutes}`;
}

function convertTo24(timeStr) {
  if (!timeStr) return "";
  let s = timeStr.trim();

  // If input already has AM/PM, just normalize it
  const ampmMatch = s.match(/\b([AaPp][Mm])\b/);
  if (ampmMatch) {
    let [h, m] = s
      .replace(/\s*[AaPp][Mm]\b/, "")
      .split(":")
      .map((x) => parseInt(x, 10));
    if (isNaN(h) || isNaN(m)) return timeStr;
    let period = ampmMatch[1];
    h = h % 12; // keep within 1–12 range
    if (h === 0) h = 12;
    return `${h}:${String(m).padStart(2, "0")} ${period}`;
  }

  // If input is 24h (HH:mm), convert to 12h
  const [hRaw, mRaw] = s.split(":").map((x) => parseInt(x, 10));
  if (isNaN(hRaw) || isNaN(mRaw)) return timeStr;

  let period = hRaw >= 12 ? "pm" : "am";
  let h = hRaw % 12;
  if (h === 0) h = 12;

  return `${h}:${String(mRaw).padStart(2, "0")} ${period}`;
}

function parseGeneratedText(text) {
  try {
    const j = JSON.parse(text);
    if (j && (j.date || Array.isArray(j.routes))) return j;
  } catch {}
  const dateMatch =
    /"date"\s*:\s*"([^"]+)"/.exec(text) ||
    /date\s*[:=]\s*([0-9]{4}-[0-9]{2}-[0-9]{2})/i.exec(text);
  const routeRegex =
    /\{[^}]*"no"\s*:\s*"([^"]+)"[^}]*"bus"\s*:\s*"([^"]+)"[^}]*"route"\s*:\s*"([^"]+)"[^}]*"time"\s*:\s*"([^"]+)"[^}]*\}/g;
  const routes = [];
  let m;
  while ((m = routeRegex.exec(text)) !== null) {
    routes.push({
      no: m[1],
      bus: m[2],
      route: m[3],
      time: convertTo24(m[4]),
    });
  }
  return {
    date: dateMatch ? dateMatch[1] : null,
    routes,
    raw: text.slice(0, 2000),
  };
}

/*exports.Register = async (req,res)=>{
    const {name,uniqueid,password,confirm_password} = req.body;
    try {
        if(!name || !uniqueid || !password || !confirm_password){
            return res.status(401).render('Register',{msg:"*Please Enter the Required List",msg_type:"Error"});
        }
        const Get = await db.collection("Register").where("UniqueID","==",uniqueid).get()
        if(!Get.empty){
            return res.status(401).render('Register',{msg:"*Unique ID is Already Exist",msg_type:"Error"});
        }
        if(password.length < 6 || confirm_password.length < 6){
            return res.status(401).render('Register',{msg:"*Password need Atleast 6 Character",msg_type:"Error"});
        }
        if(password !== confirm_password){
            return res.status(401).render('Register',{msg:"*Password do not Match",msg_type:"Error"});
        }
        const HashedPassword = await bcrypt.hash(password,10);
        await db.collection("AdminLogin").add({Name:name,UniqueID:uniqueid,Password:HashedPassword});
        return res.status(201).render('Register',{msg:"*User Registration Successfully",msg_type:"Good"});
    } catch (error) {
        console.error(error);
        return res.status(401).render('Register',{msg:"*User Registration Failed",msg_type:"Error"});
        
    }
};*/

exports.Forgot = async (req, res) => {
  const { uniqueid, password, confirm_password } = req.body;

  try {
    if (!uniqueid || !password || !confirm_password) {
      return res.status(400).render("ForgotPassword", {
        msg: "*Please enter all required fields",
        msg_type: "Error",
      });
    }

    if (password.length < 6 || confirm_password.length < 6) {
      return res.status(400).render("ForgotPassword", {
        msg: "*Password must be at least 6 characters",
        msg_type: "Error",
      });
    }

    if (password !== confirm_password) {
      return res.status(400).render("ForgotPassword", {
        msg: "*Passwords do not match",
        msg_type: "Error",
      });
    }

    const snapshot = await db
      .collection("AdminLogin")
      .where("UniqueID", "==", uniqueid)
      .get();

    if (snapshot.empty) {
      return res.status(404).render("ForgotPassword", {
        msg: "*Invalid Unique ID",
        msg_type: "Error",
      });
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    const batch = db.batch();
    snapshot.forEach((doc) => {
      const docRef = db.collection("AdminLogin").doc(doc.id);
      batch.update(docRef, { Password: hashedPassword });
    });
    await batch.commit();

    return res.status(200).render("ForgotPassword", {
      msg: "*Password updated successfully",
      msg_type: "Good",
    });
  } catch (error) {
    console.error("Forgot password error:", error);
    return res.status(500).render("ForgotPassword", {
      msg: "*An error occurred while updating password",
      msg_type: "Error",
    });
  }
};

exports.Login = async (req, res) => {
  const { uniqueid, password } = req.body;
  try {
    if (!uniqueid || !password) {
      return res.status(401).render("Login", {
        msg: "*Please Enter the Required List",
        msg_type: "Error",
      });
    }
    const Get = await db
      .collection("AdminLogin")
      .where("UniqueID", "==", uniqueid)
      .get();
    if (Get.empty) {
      return res
        .status(401)
        .render("Login", { msg: "*Invalid Unique ID", msg_type: "Error" });
    }
    const user = Get.docs[0].data();
    const storedPassword = user.Password;
    if (!(await bcrypt.compare(password, storedPassword))) {
      return res
        .status(401)
        .render("Login", { msg: "*Invalid Password", msg_type: "Error" });
    }
    const Username = user.UniqueID;
    if (
      Username === uniqueid &&
      (await bcrypt.compare(password, storedPassword))
    ) {
      req.session.user = uniqueid;
      const Token = await jwt.sign(
        { id: Get.docs[0].id, Name: user.Name, UniqueID: user.UniqueID },
        SECRET_KEY,
        { expiresIn: "1h" }
      );
      res.cookie("authToken", Token, {
        httpOnly: true,
        secure: false,
        maxAge: 3600000,
      });
      return res.status(201).redirect("/Home");
    }
  } catch (error) {
    console.error(error);
    return res
      .status(401)
      .render("Login", { msg: "*Invalid Login", msg_type: "Error" });
  }
};

exports.VerifyToken = async (req, res, next) => {
  const UserToken = req.cookies.authToken;

  if (!UserToken) {
    return res.status(401).redirect("/Login");
  }
  try {
    const Decoder = await jwt.verify(UserToken, SECRET_KEY);
    req.user = Decoder;
    next();
  } catch (error) {
    console.error(error);
    return res.status(401).redirect("/Login");
  }
};

exports.AddBus = async (req, res) => {
  const {
    BusNumber,
    TNNumber,
    ChasisNumber,
    yearofmodel,
    dateofpurchase,
    RegistrationNumber,
    RoadTaxExpiryDate,
    FCNumber,
    FCExpiryDate,
    PermitExpiryDate,
    InsuranceNumber,
    InsuranceExpiryDate,
  } = req.body;
  try {
    if (!req.file) {
      return res.status(400).render("AddBus", {
        msg: "*Please upload a driver image",
        msg_type: "Error",
      });
    }

    const result = await cloudinary.uploader.upload(req.file.path, {
      folder: "Bus_Image",
      public_id: BusNumber,
      resource_type: "image",
    });
    fs.unlinkSync(req.file.path);

    const image = {
      id: uuidv4(),
      url: result.secure_url,
      public_id: result.public_id,
    };
    await db.collection("BusDetails").add({
      Bus_Number: BusNumber,
      TN_Number: TNNumber,
      Chasis_Number: ChasisNumber,
      Year_of_Model: yearofmodel,
      Date_of_Purchase: dateofpurchase,
      Registration_Number: RegistrationNumber,
      RoadTax_Expiry_Date: RoadTaxExpiryDate,
      FC_Number: FCNumber,
      FC_Expiry_Date: FCExpiryDate,
      Permit_Expiry_Date: PermitExpiryDate,
      Insurance_Number: InsuranceNumber,
      Insurance_Expiry_Date: InsuranceExpiryDate,
      BusImage: image,
    });
    return res
      .status(201)
      .render("AddBus", { msg: "*Submitted Successfully", msg_type: "Good" });
  } catch (error) {
    console.error(error);
    return res
      .status(401)
      .render("AddBus", { msg: "*Please Try Again later", msg_type: "Error" });
  }
};

exports.BusDetails = async (req, res) => {
  try {
    const folderName = "Bus_Image";
    const result = await cloudinary.search
      .expression(`folder:${folderName}`)
      .sort_by("public_id")
      .execute();

    const Get = await db.collection("BusDetails").get();
    const Print = Get.docs.map((doc) => {
      const data = doc.data();
      const BusImage = result.resources.find((img) =>
        img.public_id.includes(data.Bus_Number)
      );
      return {
        id: doc.id,
        ...data,
        imageUrl: BusImage ? `${BusImage.secure_url}?v=${Date.now()}` : null,
      };
    });

    return res.status(200).render("BusDetails", { Print });
  } catch (error) {
    console.error(error);
  }
};

exports.EditBus = async (req, res) => {
  try {
    const id = req.params.id;
    const Get = await db.collection("BusDetails").doc(id).get();
    const Data = { id: Get.id, ...Get.data() };
    return res.status(201).render("EditBus", { Print: Data });
  } catch (error) {
    console.error(error);
  }
};

exports.UpdateBus = async (req, res) => {
  const id = req.params.id;
  const {
    BusNumber,
    TNNumber,
    ChasisNumber,
    yearofmodel,
    dateofpurchase,
    RegistrationNumber,
    RoadTaxExpiryDate,
    FCNumber,
    FCExpiryDate,
    PermitExpiryDate,
    InsuranceNumber,
    InsuranceExpiryDate,
  } = req.body;
  try {
    const Get = await db.collection("BusDetails").doc(id).get();
    const Data = { id: Get.id, ...Get.data() };

    if (req.file) {
      const publicId = Data?.BusImage?.public_id;
      if (publicId) {
        await cloudinary.uploader.destroy(publicId);
      }

      const result = await cloudinary.uploader.upload(req.file.path, {
        folder: "Bus_Image",
        public_id: BusNumber,
        resource_type: "image",
      });
      fs.unlinkSync(req.file.path);

      const image = {
        id: uuidv4(),
        url: result.secure_url,
        public_id: result.public_id,
      };

      await db.collection("BusDetails").doc(id).update({
        Bus_Number: BusNumber,
        TN_Number: TNNumber,
        Chasis_Number: ChasisNumber,
        Year_of_Model: yearofmodel,
        Date_of_Purchase: dateofpurchase,
        Registration_Number: RegistrationNumber,
        RoadTax_Expiry_Date: RoadTaxExpiryDate,
        FC_Number: FCNumber,
        FC_Expiry_Date: FCExpiryDate,
        Permit_Expiry_Date: PermitExpiryDate,
        Insurance_Number: InsuranceNumber,
        Insurance_Expiry_Date: InsuranceExpiryDate,
        BusImage: image,
      });
    } else {
      await db.collection("BusDetails").doc(id).update({
        Bus_Number: BusNumber,
        TN_Number: TNNumber,
        Chasis_Number: ChasisNumber,
        Year_of_Model: yearofmodel,
        Date_of_Purchase: dateofpurchase,
        Registration_Number: RegistrationNumber,
        RoadTax_Expiry_Date: RoadTaxExpiryDate,
        FC_Number: FCNumber,
        FC_Expiry_Date: FCExpiryDate,
        Permit_Expiry_Date: PermitExpiryDate,
        Insurance_Number: InsuranceNumber,
        Insurance_Expiry_Date: InsuranceExpiryDate,
      });
    }
    return res.redirect("/BusDetails");
  } catch (error) {
    console.error(error);
    return res
      .status(401)
      .render("EditBus", { msg: "*Please Try Again later", msg_type: "Error" });
  }
};

exports.DeleteBus = async (req, res) => {
  const id = req.params.id;
  const Get = await db.collection("BusDetails").doc(id).get();
  const Data = { id: Get.id, ...Get.data() };
  const publicId = Data?.BusImage?.public_id;
  if (publicId) {
    await cloudinary.uploader.destroy(publicId);
  }
  await db.collection("BusDetails").doc(id).delete();
  return res.redirect("/BusDetails");
};

exports.AddUser = async (req, res) => {
  const {
    DriverName,
    LicenceNumber,
    LicenceExpiryDate,
    ContactNumber,
    Uniqueid,
    Password,
    ConfirmPassword,
    AadharNumber,
  } = req.body;

  try {
    const existing = await db
      .collection("Register")
      .where("UniqueID", "==", Uniqueid)
      .get();

    if (!existing.empty) {
      return res.status(400).render("AddUser", {
        msg: "*Unique ID Already Exists",
        msg_type: "Error",
      });
    }
    if (Password.length < 6) {
      return res.status(400).render("AddUser", {
        msg: "*Password must be at least 6 characters",
        msg_type: "Error",
      });
    }
    if (Password !== ConfirmPassword) {
      return res.status(400).render("AddUser", {
        msg: "*Passwords do not match",
        msg_type: "Error",
      });
    }
    if (!req.file) {
      return res.status(400).render("AddUser", {
        msg: "*Please upload a driver image",
        msg_type: "Error",
      });
    }

    const result = await cloudinary.uploader.upload(req.file.path, {
      folder: "Driver_Image",
      public_id: Uniqueid,
      resource_type: "image",
    });
    fs.unlinkSync(req.file.path);

    const image = {
      id: uuidv4(),
      url: result.secure_url,
      public_id: result.public_id,
    };

    const hashedPassword = await bcrypt.hash(Password, 10);

    await db.collection("Register").add({
      Name: DriverName,
      Licence_Number: LicenceNumber,
      Licence_Expiry_Date: LicenceExpiryDate,
      Contact_Number: ContactNumber,
      Aadhar_Number: AadharNumber,
      UniqueID: Uniqueid,
      Password: hashedPassword,
      DriverImage: image,
    });

    return res
      .status(201)
      .render("AddUser", { msg: "*Submitted Successfully", msg_type: "Good" });
  } catch (error) {
    console.error(error);
    return res
      .status(500)
      .render("AddUser", { msg: "*Please Try Again later", msg_type: "Error" });
  }
};

exports.DriverDetails = async (req, res) => {
  try {
    const folderName = "Driver_Image";
    const result = await cloudinary.search
      .expression(`folder:${folderName}`)
      .sort_by("public_id")
      .execute();

    const Get = await db.collection("Register").get();
    const Print = Get.docs.map((doc) => {
      const data = doc.data();
      const driverImage = result.resources.find((img) =>
        img.public_id.includes(data.UniqueID)
      );
      return {
        id: doc.id,
        ...data,
        imageUrl: driverImage
          ? `${driverImage.secure_url}?v=${Date.now()}`
          : null,
      };
    });

    return res.status(200).render("DriverDetails", { Print });
  } catch (error) {
    console.error(error);
  }
};

exports.EditUser = async (req, res) => {
  try {
    const id = req.params.id;
    const Get = await db.collection("Register").doc(id).get();
    const Data = { id: Get.id, ...Get.data() };
    return res.status(201).render("EditUser", { Print: Data });
  } catch (error) {
    console.error(error);
  }
};

exports.UpdateUser = async (req, res) => {
  const id = req.params.id;
  const {
    DriverName,
    DriverID,
    LicenceNumber,
    LicenceExpiryDate,
    ContactNumber,
    AadharNumber,
  } = req.body;
  try {
    const Get = await db.collection("Register").doc(id).get();
    const Data = { id: Get.id, ...Get.data() };

    if (req.file) {
      const publicId = Data?.DriverImage?.public_id;
      if (publicId) {
        await cloudinary.uploader.destroy(publicId);
      }

      const result = await cloudinary.uploader.upload(req.file.path, {
        folder: "Driver_Image",
        public_id: DriverID,
        resource_type: "image",
      });
      fs.unlinkSync(req.file.path);

      const image = {
        id: uuidv4(),
        url: result.secure_url,
        public_id: result.public_id,
      };

      await db.collection("Register").doc(id).update({
        Name: DriverName,
        UniqueID: DriverID,
        Licence_Number: LicenceNumber,
        Licence_Expiry_Date: LicenceExpiryDate,
        Contact_Number: ContactNumber,
        Aadhar_Number: AadharNumber,
        DriverImage: image,
      });
    } else {
      await db.collection("Register").doc(id).update({
        Name: DriverName,
        UniqueID: DriverID,
        Licence_Number: LicenceNumber,
        Licence_Expiry_Date: LicenceExpiryDate,
        Contact_Number: ContactNumber,
        Aadhar_Number: AadharNumber,
      });
    }

    return res.redirect("/DriverDetails");
  } catch (error) {
    console.error(error);
    return res.status(401).render("EditUser", {
      msg: "*Please Try Again later",
      msg_type: "Error",
    });
  }
};

exports.DeleteUser = async (req, res) => {
  const id = req.params.id;

  const Get = await db.collection("Register").doc(id).get();
  const Data = { id: Get.id, ...Get.data() };
  const publicId = Data?.DriverImage?.public_id;
  if (publicId) {
    await cloudinary.uploader.destroy(publicId);
  }
  await db.collection("Register").doc(id).delete();
  return res.redirect("/DriverDetails");
};

exports.ViewBus = async (req, res) => {
  const id = req.params.id;

  const docSnap = await db.collection("BusDetails").doc(id).get();
  if (!docSnap.exists) {
    return res.status(404).send("Bus not found");
  }
  const data = docSnap.data();
  const publicId = data.BusImage?.public_id;
  let imageUrl = null;

  if (publicId) {
    const result = await cloudinary.search
      .expression(`public_id:${publicId}`)
      .max_results(1)
      .execute();

    if (result.resources.length > 0) {
      imageUrl = `${result.resources[0].secure_url}?v=${Date.now()}`;
    } else {
      imageUrl = data.BusImage.url;
    }
  }

  const Print = {
    id: docSnap.id,
    ...data,
    imageUrl,
  };

  return res.status(200).render("ViewBus", { Print });
};

exports.Route = async (req, res) => {
  try {
    const Get = await db.collection("Summary").get();
    const Print = Get.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
    return res.status(201).render("AddRoute", { Print });
  } catch (error) {
    console.error(error);
  }
};

exports.AddRoute = async (req, res) => {
  const { date, no, bus, route, time } = req.body;

  try {
    const routesRef = db.collection("Routes");
    const routes = [];

    if (Array.isArray(bus)) {
      for (let i = 0; i < bus.length; i++) {
        if (bus[i] && route[i] && time[i] && no[i]) {
          routes.push({
            id: `${date}-${time[i]}-${bus[i]}`,
            date: date,
            no: no[i],
            bus: bus[i],
            route: route[i],
            time: time[i],
          });
        }
      }
    } else {
      if (bus && route && time && date && no) {
        routes.push({
          id: `${date}-${time}`,
          date,
          no,
          bus,
          route,
          time,
        });
      }
    }

    const batchAdd = db.batch();
    routes.forEach((item) => {
      const docRef = routesRef.doc(item.id);
      const { id, ...data } = item;
      batchAdd.set(docRef, data);
    });

    await batchAdd.commit();
    return res.render("AddRoute", {
      Msg: "*Added Successfully",
      Msg_type: "Good",
    });
  } catch (error) {
    console.error("Error adding routes:", error);
    return res.status(401).render("AddRoute", {
      Msg: "*Please Try Again later",
      Msg_type: "Error",
    });
  }
};

exports.Summary = async (req, res) => {
  try {
    const Get = await db.collection("Summary").get();
    const Print = Get.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
    return res.status(201).render("SummaryCollection", { Print });
  } catch (error) {
    console.error(error);
  }
};

exports.AddSummary = async (req, res) => {
  const { route } = req.body;

  try {
    const SummaryRef = db.collection("Summary");

    const snapshot = await SummaryRef.get();
    const batchDelete = db.batch();
    snapshot.forEach((doc) => {
      batchDelete.delete(doc.ref);
    });
    await batchDelete.commit();

    const routes = [];

    if (Array.isArray(route)) {
      for (let i = 0; i < route.length; i++) {
        if (route[i]) {
          routes.push({
            route: route[i],
          });
        }
      }
    } else {
      if (route) {
        routes.push({
          route,
        });
      }
    }

    const batchAdd = db.batch();
    routes.forEach((item) => {
      const docRef = SummaryRef.doc();
      batchAdd.set(docRef, item);
    });
    await batchAdd.commit();

    return res.render("SummaryCollection", {
      Msg: "*Added Successfully",
      Msg_type: "Good",
    });
  } catch (error) {
    console.error("Error updating summary routes:", error);
    return res.status(401).render("SummaryCollection", {
      Msg: "*Please Try Again later",
      Msg_type: "Error",
    });
  }
};

exports.ExtractRouteData = async (req, res) => {
  try {
    if (!req.files || req.files.length === 0)
      return res
        .status(400)
        .json({ success: false, error: "No files uploaded" });

    const prompt = `
Extract the following from this bus route schedule image:
- Date (yyyy-MM-dd)
- A list of rows with:
  - Bus Number
  - Route
  - Time
Return JSON in this format:
{
  "date": "2025-09-18",
  "routes": [
    {"no": "1", "bus": "T1", "route": "Some route", "time": "4:15 PM"}
  ]
}`;

    // Inline if <20MB
    let totalBytes = 0;
    for (const f of req.files) totalBytes += fs.statSync(f.path).size;
    const INLINE_LIMIT = 20 * 1024 * 1024;

    let contents;
    if (totalBytes <= INLINE_LIMIT) {
      const parts = [];
      for (const f of req.files) {
        const b64 = fs.readFileSync(f.path, { encoding: "base64" });
        parts.push({
          inlineData: { mimeType: f.mimetype || "image/jpeg", data: b64 },
        });
      }
      parts.push({ text: prompt });
      contents = [{ role: "user", parts }];
    } else {
      const uploaded = [];
      for (const f of req.files) {
        try {
          const fileObj = await genAI.files.upload({
            file: f.path,
            config: { mimeType: f.mimetype || "image/jpeg" },
          });
          uploaded.push(fileObj);
        } catch (err) {
          console.error("Gemini upload failed:", err);
        }
      }
      const parts = uploaded.map((u) => ({
        fileData: { mimeType: u.mimeType, fileUri: u.uri },
      }));
      parts.push({ text: prompt });
      contents = [{ role: "user", parts }];
    }

    const model = genAI.getGenerativeModel({
      model: process.env.GEMINI_MODEL || "gemini-2.0-flash",
    });
    const result = await model.generateContent({ contents });
    const text = result.response.text();
    const parsed = parseGeneratedText(text);

    for (const f of req.files) fs.unlinkSync(f.path);
    return res.json({ success: true, extracted: [parsed] });
  } catch (err) {
    console.error("Upload error:", err);
    return res
      .status(500)
      .json({ success: false, error: err.message || String(err) });
  }
};

exports.SubmitRouteData = async (req, res) => {
  try {
    if (!db) {
      return res.status(500).json({
        success: false,
        error: "Submission Fail",
      });
    }

    const { date, routes } = req.body;
    if (!date || !Array.isArray(routes) || routes.length === 0) {
      return res.status(400).json({
        success: false,
        error: "Invalid payload",
      });
    }

    const routesRef = db.collection("Routes");
    const batch = db.batch();

    for (const r of routes) {
      const bus = (r.bus || "").toString().toUpperCase();
      const formattedTime = stripAmPm(convertTo24(r.time)) || "";
      const docId = `${date}-${formattedTime}-${bus}`;
      const docRef = routesRef.doc(docId);

      batch.set(docRef, {
        date,
        no: r.no,
        bus,
        route: r.route,
        time: formattedTime,
      });
    }

    await batch.commit();
    return res.json({
      success: true,
      message: "Routes Submitted Successfully",
    });
  } catch (err) {
    console.error("SubmitRoutes error:", err);
    return res.status(500).json({
      success: false,
      error: err.message || String(err),
    });
  }
};

exports.Dashboard = async (req, res) => {
  const inputMonth = req.query.month;
  if (!inputMonth) {
    return res.render("Home", { User: req.user, Print: [], Month: null });
  }
  const currentMonth = inputMonth || new Date().toISOString().slice(0, 7);
  const now = new Date();
  const [year, month] = currentMonth.split("-");
  const start = new Date(parseInt(year), parseInt(month) - 1, 1);
  const end = new Date(parseInt(year), parseInt(month), 0, 23, 59, 59);

  const sourceSnap = await db
    .collection("SourceDetails")
    .where("source.timestamp", ">=", start)
    .where("source.timestamp", "<=", end)
    .get();

  const destSnap = await db
    .collection("DestinationDetails")
    .where("destination.timestamp", ">=", start)
    .where("destination.timestamp", "<=", end)
    .get();

  const fuelSnap = await db
    .collection("FuelDetails")
    .where("fuel.timestamp", ">=", start)
    .where("fuel.timestamp", "<=", end)
    .get();

  const busData = {};

  sourceSnap.forEach((doc) => {
    const data = doc.data();
    const busNumber = data.bus?.Bus_Number;
    const startKM = parseFloat(data.source?.start_km);
    if (!busNumber || isNaN(startKM)) return;
    busData[busNumber] = busData[busNumber] || { start: 0, end: 0, fuel: 0 };
    busData[busNumber].start += startKM;
  });

  destSnap.forEach((doc) => {
    const data = doc.data();
    const busNumber = data.bus?.Bus_Number;
    const endKM = parseFloat(data.destination?.end_km);
    if (!busNumber || isNaN(endKM)) return;
    busData[busNumber] = busData[busNumber] || { start: 0, end: 0, fuel: 0 };
    busData[busNumber].end += endKM;
  });

  fuelSnap.forEach((doc) => {
    const data = doc.data();
    const busNumber = data.bus?.Bus_Number;
    const fuelQty = parseFloat(data.fuel?.quantity);
    if (!busNumber || isNaN(fuelQty)) return;
    busData[busNumber] = busData[busNumber] || { start: 0, end: 0, fuel: 0 };
    busData[busNumber].fuel += fuelQty;
  });

  const result = Object.entries(busData).map(([busNumber, values]) => {
    const distance = values.end - values.start;
    const mileage = values.fuel > 0 ? distance / values.fuel : 0;
    return {
      Bus_Number: busNumber,
      Mileage: mileage.toFixed(2),
      Distance_Traveled: distance,
      Fuel_Used: values.fuel,
    };
  });

  result.sort((a, b) => parseFloat(b.Mileage) - parseFloat(a.Mileage));

  let formattedMonth = "";
  if (currentMonth) {
    const [year, month] = currentMonth.split("-");
    const date = new Date(year, month - 1);
    formattedMonth = date.toLocaleString("default", {
      month: "long",
      year: "numeric",
    });
  }

  return res.render("Home", {
    User: req.user,
    Print: result,
    Month: formattedMonth,
    currentMonth: currentMonth,
  });
};

exports.TripStatus = async (req, res) => {
  const busId = req.params.id;
  const selectedYear = req.body.selectedYear;
  const selectedMonth = req.body.selectedMonth;

  const busDoc = await db.collection("BusDetails").doc(busId).get();
  const Bus_Number = busDoc.data().Bus_Number;

  const snapshot = await db.collection("TripDetails").get();
  const Details = [];

  snapshot.forEach((doc) => {
    const data = doc.data();
    const timestamp = data?.trip?.timestamp?.toDate?.();
    const busNumber = data?.bus?.Bus_Number || "";

    if (!timestamp) return;
    if (busNumber.toUpperCase() !== Bus_Number) return;

    const dateStr = timestamp.toISOString().split("T")[0];
    const monthStr = dateStr.slice(0, 7); // YYYY-MM
    const yearStr = dateStr.slice(0, 4); // YYYY

    const hours = timestamp.getHours();
    const minutes = timestamp.getMinutes();
    const seconds = timestamp.getSeconds();
    const ampm = hours >= 12 ? "PM" : "AM";
    const hours12 = hours % 12 || 12;
    const minutesStr = minutes.toString().padStart(2, "0");
    const secondsStr = seconds.toString().padStart(2, "0");
    const time = `${hours12}:${minutesStr}:${secondsStr} ${ampm}`;

    const matchMonth = selectedMonth && monthStr === selectedMonth;
    const matchYear = selectedYear && yearStr === selectedYear;

    if (matchMonth || matchYear) {
      Details.push({
        Date: dateStr,
        Time: time,
        BusNumber: busNumber,
        DriverName: data.driver?.name || "N/A",
        DriverID: data.driver?.unique_id || "N/A",
        PassengerCount: data.trip?.passenger_count || 0,
      });
    }
  });

  const TripInfo = Details;
  const TotalPassengers = Details.reduce(
    (sum, trip) => sum + trip.PassengerCount,
    0
  );

  let formattedMonth = "";
  let formattedYear = "";

  if (selectedMonth) {
    const [year, month] = selectedMonth.split("-");
    const date = new Date(year, month - 1);
    formattedMonth = date.toLocaleString("default", {
      month: "long",
      year: "numeric",
    });
  }

  if (selectedYear) {
    formattedYear = selectedYear;
  }

  return res.status(200).render("TripDetails", {
    formattedMonth,
    formattedYear,
    TripInfo,
    TotalPassengers,
    busId,
  });
};

exports.MileageCalculation = async (req, res) => {
  const busId = req.params.id;
  const selectedYear = req.body.selectedYear;
  const selectedMonth = req.body.selectedMonth;

  const busDoc = await db.collection("BusDetails").doc(busId).get();
  const BusNumber = busDoc.data().Bus_Number;

  const isDateMatch = (dateStr) => {
    if (selectedMonth) return dateStr.startsWith(selectedMonth); // YYYY-MM
    if (selectedYear) return dateStr.startsWith(selectedYear); // YYYY
    return false;
  };

  // --- Fetch SourceDetails ---
  const sourceTrips = [];
  const SourceSnap = await db.collection("SourceDetails").get();
  SourceSnap.forEach((doc) => {
    const data = doc.data();
    const timestamp = data?.source?.timestamp?.toDate?.();
    if (data.bus?.Bus_Number === BusNumber && timestamp) {
      const dateStr = timestamp.toISOString().split("T")[0];
      if (isDateMatch(dateStr)) {
        sourceTrips.push({
          date: dateStr,
          start_km: parseFloat(data.source.start_km),
          timestamp,
        });
      }
    }
  });

  // --- Fetch DestinationDetails ---
  const destinationTrips = [];
  const DestinationSnap = await db.collection("DestinationDetails").get();
  DestinationSnap.forEach((doc) => {
    const data = doc.data();
    const timestamp = data?.destination?.timestamp?.toDate?.();
    if (data.bus?.Bus_Number === BusNumber && timestamp) {
      const dateStr = timestamp.toISOString().split("T")[0];
      if (isDateMatch(dateStr)) {
        destinationTrips.push({
          date: dateStr,
          end_km: parseFloat(data.destination.end_km),
          timestamp,
        });
      }
    }
  });

  // --- Fetch FuelDetails ---
  const fuelDetails = [];
  const FuelSnap = await db.collection("FuelDetails").get();
  FuelSnap.forEach((doc) => {
    const data = doc.data();
    const timestamp = data?.fuel?.timestamp?.toDate?.();
    if (data.bus?.Bus_Number === BusNumber && timestamp) {
      const dateStr = timestamp.toISOString().split("T")[0];
      if (isDateMatch(dateStr)) {
        const qty = parseFloat(data.fuel.quantity);
        if (!isNaN(qty)) {
          fuelDetails.push({
            date: dateStr,
            quantity: qty,
            timestamp,
          });
        }
      }
    }
  });

  // --- Group by date ---
  const groupByDate = (arr) => {
    const grouped = {};
    arr.forEach((item) => {
      if (!grouped[item.date]) grouped[item.date] = [];
      grouped[item.date].push(item);
    });
    return grouped;
  };

  const groupedSources = groupByDate(sourceTrips);
  const groupedDestinations = groupByDate(destinationTrips);
  const groupedFuels = groupByDate(fuelDetails);

  const allDates = new Set([
    ...Object.keys(groupedSources),
    ...Object.keys(groupedDestinations),
    ...Object.keys(groupedFuels),
  ]);

  const tripDetails = [];
  let totalDistance = 0;
  let totalFuel = 0;

  Array.from(allDates)
    .sort()
    .forEach((date) => {
      const sources = (groupedSources[date] || []).sort(
        (a, b) => a.timestamp - b.timestamp
      );
      const destinations = (groupedDestinations[date] || []).sort(
        (a, b) => a.timestamp - b.timestamp
      );
      const fuels = groupedFuels[date] || [];

      const firstSource = sources[0];
      const lastDestination = destinations[destinations.length - 1];

      let distance = 0;
      if (firstSource && lastDestination) {
        distance = lastDestination.end_km - firstSource.start_km;
      }

      const fuelQty = fuels.reduce((sum, f) => sum + f.quantity, 0);

      const mileage =
        fuelQty > 0 && distance > 0 ? (distance / fuelQty).toFixed(2) : "0";

      if (distance > 0 || fuelQty > 0) {
        tripDetails.push({
          date,
          start_km: firstSource?.start_km || "N/A",
          end_km: lastDestination?.end_km || "N/A",
          distance,
          fuel: fuelQty,
          mileage,
        });

        totalDistance += distance;
        totalFuel += fuelQty;
      }
    });

  const overallMileage =
    totalFuel > 0 ? (totalDistance / totalFuel).toFixed(2) : "0";

  // Format selectedMonth to readable form
  let formattedMonth = "";
  if (selectedMonth) {
    const [year, month] = selectedMonth.split("-");
    const date = new Date(year, month - 1);
    formattedMonth = date.toLocaleString("default", {
      month: "long",
      year: "numeric",
    });
  }

  return res.status(200).render("MileageCalculation", {
    bus_number: BusNumber,
    formattedMonth: formattedMonth || "",
    formattedYear: selectedYear || "",
    totalDistance,
    totalFuel,
    mileage: overallMileage + " km/l",
    tripDetails,
    busId,
  });
};

exports.FuelDetails = async (req, res) => {
  try {
    const busId = req.params.id;
    const selectedYear = req.body.selectedYear;
    const selectedMonth = req.body.selectedMonth;

    const busDoc = await db.collection("BusDetails").doc(busId).get();
    const BusNumber = busDoc.data().Bus_Number;

    const isDateMatch = (dateStr) => {
      if (selectedMonth) return dateStr.startsWith(selectedMonth); // yyyy-mm
      if (selectedYear) return dateStr.startsWith(selectedYear); // yyyy
      return false;
    };

    const fuelDetails = [];
    const FuelSnap = await db.collection("FuelDetails").get();

    FuelSnap.forEach((doc) => {
      const data = doc.data();
      const timestamp = data?.fuel?.timestamp?.toDate?.();

      if (data.bus?.Bus_Number === BusNumber && timestamp) {
        const dateStr = timestamp.toISOString().split("T")[0];

        if (isDateMatch(dateStr)) {
          const qty = parseFloat(data.fuel.quantity);
          const amt = parseFloat(data.fuel.amount);

          if (!isNaN(qty) && !isNaN(amt)) {
            fuelDetails.push({
              timestamp,
              bus_number: data.bus?.Bus_Number,
              name: data.driver?.name,
              unique_id: data.driver?.unique_id,
              amount: amt,
              quantity: qty,
              location: data.fuel?.location,
              imageUrl: data.fuel?.Image?.url || null,
              public_id: data.fuel?.Image?.public_id || null,
            });
          }
        }
      }
    });

    let TotalFuel = 0;
    let TotalAmount = 0;
    const FuelInfo = [];

    fuelDetails.forEach((src) => {
      TotalFuel += src.quantity;
      TotalAmount += src.amount;

      const dateTimeStr = src.timestamp.toLocaleString("en-IN", {
        timeZone: "Asia/Kolkata",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        hour12: true,
      });

      FuelInfo.push({
        date: dateTimeStr,
        bus_number: src.bus_number,
        Name: src.name,
        Unique_id: src.unique_id,
        Amount: src.amount,
        Quantity: src.quantity + "L",
        Location: src.location,
        ImageUrl: src.imageUrl ? `${src.imageUrl}?v=${Date.now()}` : null,
      });
    });

    let formattedMonth = "";
    if (selectedMonth) {
      const [year, month] = selectedMonth.split("-");
      const date = new Date(year, month - 1);
      formattedMonth = date.toLocaleString("default", {
        month: "long",
        year: "numeric",
      });
    }

    return res.status(200).render("FuelDetails", {
      bus_number: BusNumber,
      formattedMonth: formattedMonth,
      formattedYear: selectedYear || "",
      FuelInfo,
      busId,
      TotalFuel: TotalFuel.toFixed(2) + "L",
      TotalAmount: TotalAmount.toFixed(2),
    });
  } catch (error) {
    console.error("Error in FuelDetails:", error);
    return res.status(500).send("Internal Server Error");
  }
};

exports.ServiceDetails = async (req, res) => {
  const busId = req.params.id;
  const selectedYear = req.body.selectedYear;
  const selectedMonth = req.body.selectedMonth;

  const busDoc = await db.collection("BusDetails").doc(busId).get();
  const BusNumber = busDoc.data().Bus_Number;

  const isDateMatch = (dateStr) => {
    if (selectedMonth) return dateStr.startsWith(selectedMonth);
    if (selectedYear) return dateStr.startsWith(selectedYear);
    return false;
  };

  const ServiceDetails = [];
  const ServiceSnap = await db.collection("ServiceDetails").get();

  ServiceSnap.forEach((doc) => {
    const data = doc.data();
    const timestamp = data?.service?.timestamp?.toDate?.();

    if (data.bus?.Bus_Number === BusNumber && timestamp) {
      const dateStr = timestamp.toISOString().split("T")[0];
      if (isDateMatch(dateStr)) {
        const type = data.service.type;
        const note = data.service.notes;
        const amt = parseFloat(data.service.cost);

        if (!isNaN(amt)) {
          ServiceDetails.push({
            timestamp,
            bus_number: data.bus?.Bus_Number,
            name: data.driver?.name,
            unique_id: data.driver?.unique_id,
            amount: amt,
            type: type,
            note: note,
            location: data.service?.location,
            imageUrl: data.service?.Image?.url || null,
            public_id: data.service?.Image?.public_id || null,
          });
        }
      }
    }
  });

  let TotalAmount = 0;
  const ServiceInfo = [];

  ServiceDetails.forEach((entry) => {
    TotalAmount += entry.amount;

    const dateTimeStr = entry.timestamp.toLocaleString("en-IN", {
      timeZone: "Asia/Kolkata",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: true,
    });

    ServiceInfo.push({
      date: dateTimeStr,
      bus_number: entry.bus_number,
      Name: entry.name,
      Unique_id: entry.unique_id,
      Amount: entry.amount,
      Type: entry.type,
      Note: entry.note,
      Location: entry.location,
      ImageUrl: entry.imageUrl ? `${entry.imageUrl}?v=${Date.now()}` : null,
    });
  });

  let formattedMonth = "";
  if (selectedMonth) {
    const [year, month] = selectedMonth.split("-");
    const date = new Date(year, month - 1);
    formattedMonth = date.toLocaleString("default", {
      month: "long",
      year: "numeric",
    });
  }

  return res.status(200).render("ServiceDetails", {
    bus_number: BusNumber,
    formattedMonth: selectedMonth || "",
    formattedYear: selectedYear || "",
    ServiceInfo,
    busId,
    TotalAmount: TotalAmount.toFixed(2),
  });
};

exports.SourceDetails = async (req, res) => {
  const busId = req.params.id;
  const selectedYear = req.body.selectedYear;
  const selectedMonth = req.body.selectedMonth;

  const busDoc = await db.collection("BusDetails").doc(busId).get();
  const BusNumber = busDoc.data().Bus_Number;

  const isDateMatch = (dateStr) => {
    if (selectedMonth) return dateStr.startsWith(selectedMonth);
    if (selectedYear) return dateStr.startsWith(selectedYear);
    return false;
  };

  const SourceDetails = [];
  const SourceSnap = await db.collection("SourceDetails").get();

  SourceSnap.forEach((doc) => {
    const data = doc.data();
    const timestamp = data?.source?.timestamp?.toDate?.();

    if (data.bus?.Bus_Number === BusNumber && timestamp) {
      const dateStr = timestamp.toISOString().split("T")[0];
      if (isDateMatch(dateStr)) {
        SourceDetails.push({
          date: dateStr,
          bus_number: data.bus?.Bus_Number,
          name: data.driver?.name,
          unique_id: data.driver?.unique_id,
          start_km: data.source?.start_km,
          route: data.source?.route,
          location: data.source?.location,
        });
      }
    }
  });

  let formattedMonth = "";
  if (selectedMonth) {
    const [year, month] = selectedMonth.split("-");
    const date = new Date(year, month - 1);
    formattedMonth = date.toLocaleString("default", {
      month: "long",
      year: "numeric",
    });
  }

  return res.status(200).render("SourceDetails", {
    bus_number: BusNumber,
    formattedMonth: selectedMonth || "",
    formattedYear: selectedYear || "",
    busId,
    SourceDetails,
  });
};

exports.DestinationDetails = async (req, res) => {
  const busId = req.params.id;
  const selectedYear = req.body.selectedYear;
  const selectedMonth = req.body.selectedMonth;

  const busDoc = await db.collection("BusDetails").doc(busId).get();
  const BusNumber = busDoc.data().Bus_Number;

  const isDateMatch = (dateStr) => {
    if (selectedMonth) return dateStr.startsWith(selectedMonth);
    if (selectedYear) return dateStr.startsWith(selectedYear);
    return false;
  };

  const DestinationDetails = [];
  const DestinationSnap = await db.collection("DestinationDetails").get();

  DestinationSnap.forEach((doc) => {
    const data = doc.data();
    const timestamp = data?.destination?.timestamp?.toDate?.();

    if (data.bus?.Bus_Number === BusNumber && timestamp) {
      const dateStr = timestamp.toISOString().split("T")[0];
      if (isDateMatch(dateStr)) {
        DestinationDetails.push({
          date: dateStr,
          bus_number: data.bus?.Bus_Number,
          name: data.driver?.name,
          unique_id: data.driver?.unique_id,
          end_km: data.destination?.end_km,
          route: data.destination?.route,
          location: data.destination?.location,
        });
      }
    }
  });

  let formattedMonth = "";
  if (selectedMonth) {
    const [year, month] = selectedMonth.split("-");
    const date = new Date(year, month - 1);
    formattedMonth = date.toLocaleString("default", {
      month: "long",
      year: "numeric",
    });
  }

  return res.status(200).render("DestinationDetails", {
    bus_number: BusNumber,
    formattedMonth: selectedMonth || "",
    formattedYear: selectedYear || "",
    busId,
    DestinationDetails,
  });
};

exports.SourceChecklist = async (req, res) => {
  const busId = req.params.id;
  const selectedYear = req.body.selectedYear;
  const selectedMonth = req.body.selectedMonth;

  const busDoc = await db.collection("BusDetails").doc(busId).get();
  const BusNumber = busDoc.data().Bus_Number;

  const isDateMatch = (dateStr) => {
    if (selectedMonth) return dateStr.startsWith(selectedMonth);
    if (selectedYear) return dateStr.startsWith(selectedYear);
    return false;
  };

  const SourceDetails = [];
  let DriverName = "";
  let UniqueID = "";

  const SourceSnap = await db.collection("SourceDetails").get();

  SourceSnap.forEach((doc) => {
    const data = doc.data();
    const timestamp = data?.source?.timestamp?.toDate?.();

    if (data.bus?.Bus_Number === BusNumber && timestamp) {
      const dateStr = timestamp.toISOString().split("T")[0];
      if (isDateMatch(dateStr)) {
        DriverName = data?.driver?.name || "";
        UniqueID = data?.driver?.unique_id || "";

        const checklistRaw = data.checklist || {};

        const keyMap = {
          "Brakes / பிரேக்": "Brakes",
          "Gear Box / கியர் பாக்ஸ்": "GearBox",
          "Lights / லைட்கள்": "Lights",
          "Steering / ஸ்டீயரிங்": "Steering",
          "Tires / டயர்": "Tires",
          "Wipers / வைப்பர்கள்": "Wipers",
        };

        const checklist = {};

        for (const [originalKey, mappedKey] of Object.entries(keyMap)) {
          checklist[mappedKey] = checklistRaw[originalKey]
            ? "Checked"
            : "Not Checked";
        }

        SourceDetails.push({
          date: dateStr,
          checklist,
          DriverName,
          UniqueID,
        });
      }
    }
  });

  let formattedMonth = "";
  if (selectedMonth) {
    const [year, month] = selectedMonth.split("-");
    const date = new Date(year, month - 1);
    formattedMonth = date.toLocaleString("default", {
      month: "long",
      year: "numeric",
    });
  }

  return res.status(200).render("SourceChecklist", {
    bus_number: BusNumber,
    formattedMonth: selectedMonth || "",
    formattedYear: selectedYear || "",
    busId,
    SourceDetails,
    DriverName,
    UniqueID,
  });
};

exports.DestinationChecklist = async (req, res) => {
  const busId = req.params.id;
  const selectedYear = req.body.selectedYear;
  const selectedMonth = req.body.selectedMonth;

  const busDoc = await db.collection("BusDetails").doc(busId).get();
  const BusNumber = busDoc.data().Bus_Number;

  const isDateMatch = (dateStr) => {
    if (selectedMonth) return dateStr.startsWith(selectedMonth);
    if (selectedYear) return dateStr.startsWith(selectedYear);
    return false;
  };

  const DestinationDetails = [];
  let DriverName = "";
  let UniqueID = "";

  const DestinationSnap = await db.collection("DestinationDetails").get();

  DestinationSnap.forEach((doc) => {
    const data = doc.data();
    const timestamp = data?.destination?.timestamp?.toDate?.();

    if (data.bus?.Bus_Number === BusNumber && timestamp) {
      const dateStr = timestamp.toISOString().split("T")[0];
      if (isDateMatch(dateStr)) {
        DriverName = data?.driver?.name || "";
        UniqueID = data?.driver?.unique_id || "";

        const checklistRaw = data.checklist || {};

        const keyMap = {
          "Brakes / பிரேக்": "Brakes",
          "Gear Box / கியர் பாக்ஸ்": "GearBox",
          "Lights / லைட்கள்": "Lights",
          "Steering / ஸ்டீயரிங்": "Steering",
          "Tires / டயர்": "Tires",
          "Wipers / வைப்பர்கள்": "Wipers",
        };

        const checklist = {};

        for (const [originalKey, mappedKey] of Object.entries(keyMap)) {
          checklist[mappedKey] = checklistRaw[originalKey]
            ? "Checked"
            : "Not Checked";
        }

        DestinationDetails.push({
          date: dateStr,
          checklist,
          DriverName,
          UniqueID,
        });
      }
    }
  });

  let formattedMonth = "";
  if (selectedMonth) {
    const [year, month] = selectedMonth.split("-");
    const date = new Date(year, month - 1);
    formattedMonth = date.toLocaleString("default", {
      month: "long",
      year: "numeric",
    });
  }

  return res.status(200).render("DestinationChecklist", {
    bus_number: BusNumber,
    formattedMonth: selectedMonth || "",
    formattedYear: selectedYear || "",
    busId,
    DestinationDetails,
    DriverName,
    UniqueID,
  });
};

exports.BusReport = async (req, res) => {
  const selectedMonth = req.body.selectedMonth || "";
  const selectedYear = req.body.selectedYear || "";
  let Bus_Number = req.body.Bus_Number || "";
  Bus_Number = Bus_Number.toUpperCase();

  const folderName = "Bus_Image";
  const result = await cloudinary.search
    .expression(`folder:${folderName}`)
    .sort_by("public_id")
    .execute();

  const busSnap = await db
    .collection("BusDetails")
    .where("Bus_Number", "==", Bus_Number)
    .limit(1)
    .get();

  let BusDetailsData = null;
  if (!busSnap.empty) {
    const doc = busSnap.docs[0];
    const data = doc.data();
    const BusImage = result.resources.find((img) =>
      img.public_id.includes(data.Bus_Number)
    );
    BusDetailsData = {
      id: doc.id,
      ...data,
      imageUrl: BusImage ? `${BusImage.secure_url}?v=${Date.now()}` : null,
    };
  }

  const isDateMatch = (dateStr) => {
    if (selectedMonth) return dateStr.startsWith(selectedMonth);
    if (selectedYear) return dateStr.startsWith(selectedYear);
    return false;
  };

  const TripInfo = [];
  let TotalPassengers = 0;
  const TripSnap = await db.collection("TripDetails").get();
  TripSnap.forEach((doc) => {
    const data = doc.data();
    const timestamp = data?.trip?.timestamp?.toDate?.();
    const busNumber = data?.bus?.Bus_Number?.toUpperCase();
    if (!timestamp || busNumber !== Bus_Number) return;

    const dateStr = timestamp.toISOString().split("T")[0];
    if (!isDateMatch(dateStr)) return;

    const hours = timestamp.getHours();
    const minutes = timestamp.getMinutes();
    const seconds = timestamp.getSeconds();
    const ampm = hours >= 12 ? "PM" : "AM";
    const hours12 = hours % 12 || 12;
    const time = `${hours12}:${minutes.toString().padStart(2, "0")}:${seconds
      .toString()
      .padStart(2, "0")} ${ampm}`;

    TripInfo.push({
      Date: dateStr,
      Time: time,
      BusNumber: busNumber,
      DriverName: data.driver?.name || "N/A",
      DriverID: data.driver?.unique_id || "N/A",
      PassengerCount: data.trip?.passenger_count || 0,
    });

    TotalPassengers += data.trip?.passenger_count || 0;
  });

  const sourceTrips = [],
    destinationTrips = [];
  const SourceSnap = await db.collection("SourceDetails").get();
  SourceSnap.forEach((doc) => {
    const data = doc.data();
    const timestamp = data?.source?.timestamp?.toDate?.();
    const dateStr = timestamp?.toISOString().split("T")[0];
    if (
      data.bus?.Bus_Number?.toUpperCase() === Bus_Number &&
      timestamp &&
      isDateMatch(dateStr)
    ) {
      sourceTrips.push({
        date: dateStr,
        start_km: parseFloat(data.source.start_km),
        timestamp,
      });
    }
  });

  const DestinationSnap = await db.collection("DestinationDetails").get();
  DestinationSnap.forEach((doc) => {
    const data = doc.data();
    const timestamp = data?.destination?.timestamp?.toDate?.();
    const dateStr = timestamp?.toISOString().split("T")[0];
    if (
      data.bus?.Bus_Number?.toUpperCase() === Bus_Number &&
      timestamp &&
      isDateMatch(dateStr)
    ) {
      destinationTrips.push({
        date: dateStr,
        end_km: parseFloat(data.destination.end_km),
        timestamp,
      });
    }
  });

  const fuelDetails = [];
  const FuelSnap = await db.collection("FuelDetails").get();
  FuelSnap.forEach((doc) => {
    const data = doc.data();
    const timestamp = data?.fuel?.timestamp?.toDate?.();
    const dateStr = timestamp?.toISOString().split("T")[0];
    if (
      data.bus?.Bus_Number?.toUpperCase() === Bus_Number &&
      timestamp &&
      isDateMatch(dateStr)
    ) {
      const qty = parseFloat(data.fuel.quantity);
      const amt = parseFloat(data.fuel.amount);
      if (!isNaN(qty) && !isNaN(amt)) {
        fuelDetails.push({
          date: dateStr,
          quantity: qty,
          amount: amt,
          name: data.driver?.name,
          unique_id: data.driver?.unique_id,
        });
      }
    }
  });

  const serviceDetails = [];
  const ServiceSnap = await db.collection("ServiceDetails").get();
  ServiceSnap.forEach((doc) => {
    const data = doc.data();
    const timestamp = data?.service?.timestamp?.toDate?.();
    const dateStr = timestamp?.toISOString().split("T")[0];
    if (
      data.bus?.Bus_Number?.toUpperCase() === Bus_Number &&
      timestamp &&
      isDateMatch(dateStr)
    ) {
      const amt = parseFloat(data.service.cost);
      if (!isNaN(amt)) {
        serviceDetails.push({
          date: dateStr,
          amount: amt,
          name: data.driver?.name,
          unique_id: data.driver?.unique_id,
          type: data.service?.type,
          note: data.service?.notes,
        });
      }
    }
  });

  const groupByDate = (arr) =>
    arr.reduce((map, item) => {
      if (!map[item.date]) map[item.date] = [];
      map[item.date].push(item);
      return map;
    }, {});

  const groupedSources = groupByDate(sourceTrips);
  const groupedDestinations = groupByDate(destinationTrips);
  const groupedFuels = groupByDate(fuelDetails);

  const mileageDetails = [];
  let totalDistance = 0,
    totalFuelUsed = 0;

  Object.keys(groupedSources).forEach((date) => {
    const srcs = groupedSources[date].sort((a, b) => a.timestamp - b.timestamp);
    const dests =
      groupedDestinations[date]?.sort((a, b) => a.timestamp - b.timestamp) ||
      [];
    const fuelQty = (groupedFuels[date] || []).reduce(
      (sum, f) => sum + f.quantity,
      0
    );

    const pairCount = Math.min(srcs.length, dests.length);
    const fuelPerTrip = pairCount > 0 ? fuelQty / pairCount : 0;

    for (let i = 0; i < pairCount; i++) {
      const distance = dests[i].end_km - srcs[i].start_km;
      if (distance > 0) {
        mileageDetails.push({
          date,
          start_km: srcs[i].start_km,
          end_km: dests[i].end_km,
          distance,
          fuel: fuelPerTrip,
          mileage: fuelPerTrip > 0 ? (distance / fuelPerTrip).toFixed(2) : "0",
        });
        totalDistance += distance;
        totalFuelUsed += fuelPerTrip;
      }
    }
  });

  const TotalFuel = fuelDetails.reduce((sum, f) => sum + f.quantity, 0);
  const overallMileage =
    TotalFuel > 0 ? (totalDistance / TotalFuel).toFixed(2) : "0";
  const TotalFuelAmount = fuelDetails.reduce((sum, f) => sum + f.amount, 0);
  const TotalServiceAmount = serviceDetails.reduce(
    (sum, s) => sum + s.amount,
    0
  );

  const formattedMonth = selectedMonth
    ? new Date(selectedMonth + "-01").toLocaleString("default", {
        month: "long",
        year: "numeric",
      })
    : "";
  const totalExpense = TotalFuelAmount + TotalServiceAmount;

  return res.status(200).render("Bus_Reports", {
    bus_number: Bus_Number,
    formattedMonth,
    formattedYear: selectedYear,
    BusDetailsData,
    TripInfo,
    TotalPassengers,
    mileageDetails,
    totalDistance,
    totalFuelUsed,
    overallMileage,
    fuelDetails,
    TotalFuel,
    TotalFuelAmount: TotalFuelAmount.toFixed(2),
    serviceDetails,
    TotalServiceAmount,
    totalExpense,
  });
};

exports.SendReport = async (req, res) => {
  try {
    const { year, month, adminEmail } = req.body;

    if (!year || !month || !adminEmail) {
      return res.render("EmailSending", { msg: "Missing input values!",msg_type:"Error" });
    }

    const result = await generateAndSendReport(year, month, adminEmail);

    if (result.success) {
      res.render("EmailSending", { msg: "Report Sent Successfully!",msg_type:"Good" });
    } else {
      res.render("EmailSending", { msg: "No data for this month!",msg_type:"Error" });
    }
  } catch (err) {
    console.error("Error sending report", err);
    res.render("EmailSending", { msg: "Failed to send report!",msg_type:"Error" });
  }
};
