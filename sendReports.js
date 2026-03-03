// sendReports.js
require("dotenv").config();
const db = require("./Database/FirebaseConfig");
const cloudinary = require("cloudinary").v2;
const nodemailer = require("nodemailer");
const puppeteer = require("puppeteer");
const Handlebars = require("handlebars");
const readline = require("readline");

// --------- Cloudinary (optional) ----------
if (process.env.CLOUDINARY_CLOUD_NAME) {
  cloudinary.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    api_key: process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET,
  });
}

// --------- Nodemailer transporter ----------
const transporter = nodemailer.createTransport({
  host: process.env.MAILJET_HOST || "in-v3.mailjet.com",
  port: parseInt(process.env.MAILJET_PORT || "587", 10),
  secure: false,
  auth: {
    user: process.env.MAILJET_API_KEY,
    pass: process.env.MAILJET_API_SECRET,
  },
});


// --------- Helper: format and check month ----------
function getFormattedMonth(year, month) {
  const date = new Date(year, month - 1);
  const formattedMonth = date.toLocaleString("default", {
    month: "long",
    year: "numeric",
  });
  const selectedMonth = `${year}-${String(month).padStart(2, "0")}`;
  return { selectedMonth, formattedMonth };
}

// --------- Utility: check if date string (YYYY-MM-DD) belongs to selected month ----------
function isDateMatch(dateStr, selectedMonth) {
  return typeof dateStr === "string" && dateStr.startsWith(selectedMonth);
}

// --------- Fetch all collections ----------
async function fetchAllCollectionsOnce() {
  const [busSnap, fuelSnap, serviceSnap, sourceSnap, destSnap] =
    await Promise.all([
      db.collection("BusDetails").get(),
      db.collection("FuelDetails").get(),
      db.collection("ServiceDetails").get(),
      db.collection("SourceDetails").get(),
      db.collection("DestinationDetails").get(),
    ]);

  return {
    buses: busSnap.docs.map((d) => ({ id: d.id, ...d.data() })),
    fuelDocs: fuelSnap.docs.map((d) => ({ id: d.id, ...d.data() })),
    serviceDocs: serviceSnap.docs.map((d) => ({ id: d.id, ...d.data() })),
    sourceDocs: sourceSnap.docs.map((d) => ({ id: d.id, ...d.data() })),
    destDocs: destSnap.docs.map((d) => ({ id: d.id, ...d.data() })),
  };
}

// --------- Build reports for ALL buses ----------
async function buildReports({
  buses,
  fuelDocs,
  serviceDocs,
  sourceDocs,
  destDocs,
}, selectedMonth, formattedMonth) {

  let cloudinaryResources = [];
  try {
    if (process.env.CLOUDINARY_CLOUD_NAME) {
      const folderName = "Bus_Image";
      const result = await cloudinary.search
        .expression(`folder:${folderName}`)
        .sort_by("public_id")
        .max_results(500)
        .execute();
      cloudinaryResources = result.resources || [];
    }
  } catch (err) {
    console.warn(
      "Cloudinary search failed (continuing without images):",
      err.message || err
    );
    cloudinaryResources = [];
  }

  const reports = [];

  for (const bus of buses) {
    const Bus_Number = (bus.Bus_Number || "").toUpperCase();
    if (!Bus_Number) continue;

    let BusImage = null;
    if (cloudinaryResources.length) {
      BusImage = cloudinaryResources.find(
        (r) => r.public_id && r.public_id.includes(Bus_Number)
      );
    }

    const BusDetailsData = {
      Bus_Number,
      TN_Number: bus.TN_Number || "",
      Registration_Number: bus.Registration_Number || "",
      FC_Number: bus.FC_Number || "",
      Insurance_Number: bus.Insurance_Number || "",
      imageUrl: BusImage ? `${BusImage.secure_url}?v=${Date.now()}` : null,
    };

    // Fuel details
    const fuelDetails = fuelDocs
      .filter((d) => d.bus?.Bus_Number?.toUpperCase() === Bus_Number)
      .map((d) => {
        const ts = d.fuel?.timestamp?.toDate
          ? d.fuel.timestamp.toDate()
          : d.fuel?.timestamp
          ? new Date(d.fuel.timestamp)
          : null;
        const dateStr = ts ? ts.toISOString().split("T")[0] : null;
        return {
          raw: d,
          dateStr,
          qty: parseFloat(d.fuel?.quantity || 0),
          amt: parseFloat(d.fuel?.amount || 0),
        };
      })
      .filter(
        (x) =>
          x.dateStr && isDateMatch(x.dateStr) && !isNaN(x.qty) && !isNaN(x.amt)
      )
      .map((x) => ({ date: x.dateStr, quantity: x.qty, amount: x.amt }));

    // Service details
    const serviceDetails = serviceDocs
      .filter((d) => d.bus?.Bus_Number?.toUpperCase() === Bus_Number)
      .map((d) => {
        const ts = d.service?.timestamp?.toDate
          ? d.service.timestamp.toDate()
          : d.service?.timestamp
          ? new Date(d.service.timestamp)
          : null;
        const dateStr = ts ? ts.toISOString().split("T")[0] : null;
        const amt = parseFloat(d.service?.cost || 0);
        return {
          date: dateStr,
          amount: amt,
          type: d.service?.type || "N/A",
          note: d.service?.notes || "",
        };
      })
      .filter((x) => x.date && isDateMatch(x.date) && !isNaN(x.amount));

    // Source & Destination for mileage
    const srcByDate = {};
    sourceDocs.forEach((d) => {
      const ts = d.source?.timestamp?.toDate
        ? d.source.timestamp.toDate()
        : d.source?.timestamp
        ? new Date(d.source.timestamp)
        : null;
      const dateStr = ts ? ts.toISOString().split("T")[0] : null;
      if (
        d.bus?.Bus_Number?.toUpperCase() === Bus_Number &&
        dateStr &&
        isDateMatch(dateStr)
      ) {
        if (!srcByDate[dateStr]) srcByDate[dateStr] = [];
        srcByDate[dateStr].push({
          start_km: parseFloat(d.source.start_km || 0),
          ts,
        });
      }
    });
    const destByDate = {};
    destDocs.forEach((d) => {
      const ts = d.destination?.timestamp?.toDate
        ? d.destination.timestamp.toDate()
        : d.destination?.timestamp
        ? new Date(d.destination.timestamp)
        : null;
      const dateStr = ts ? ts.toISOString().split("T")[0] : null;
      if (
        d.bus?.Bus_Number?.toUpperCase() === Bus_Number &&
        dateStr &&
        isDateMatch(dateStr, selectedMonth)
      ) {
        if (!destByDate[dateStr]) destByDate[dateStr] = [];
        destByDate[dateStr].push({
          end_km: parseFloat(d.destination.end_km || 0),
          ts,
        });
      }
    });

    // Compute mileage
    let totalDistance = 0;
    Object.keys(srcByDate).forEach((date) => {
      const srcs = srcByDate[date].sort((a, b) => a.ts - b.ts);
      const dests = (destByDate[date] || []).sort((a, b) => a.ts - b.ts);
      const fuelForDate = fuelDetails
        .filter((f) => f.date === date)
        .reduce((s, f) => s + f.quantity, 0);
      const pairCount = Math.min(srcs.length, dests.length);
      const fuelPerTrip = pairCount > 0 ? fuelForDate / pairCount : 0;
      for (let i = 0; i < pairCount; i++) {
        const dist = dests[i].end_km - srcs[i].start_km;
        if (dist > 0) {
          totalDistance += dist;
        }
      }
    });

    const TotalFuel = fuelDetails.reduce((s, f) => s + f.quantity, 0);
    const overallMileage =
      TotalFuel > 0 ? (totalDistance / TotalFuel).toFixed(2) : "0";
    const TotalFuelAmount = fuelDetails.reduce((s, f) => s + f.amount, 0);
    const TotalServiceAmount = serviceDetails.reduce(
      (s, sObj) => s + sObj.amount,
      0
    );
    const totalExpense = TotalFuelAmount + TotalServiceAmount;

    reports.push({
      bus_number: Bus_Number,
      formattedMonth,
      BusDetailsData,
      totalDistance,
      TotalFuel,
      overallMileage,
      TotalFuelAmount: TotalFuelAmount.toFixed(2),
      serviceDetails,
      TotalServiceAmount,
      totalExpense,
    });
  }

  return reports;
}

// --------- Generate PDF ----------
async function generatePdfBuffer(reports, formattedMonth) {
  const templateHtml = `
    <!doctype html>
    <html>
    <head>
      <meta charset="utf-8"/>
      <title>Bus Reports - {{formattedMonth}}</title>
      <style>
        body { font-family: Arial, Helvetica, sans-serif; margin:20px; }
        .bus-page { page-break-after: always; }
        .header { text-align:center; margin-bottom:10px; }
        .flex { display:flex; gap:20px; align-items:flex-start; }
        img.bus-img { width:132px; height:170px; object-fit:contain; border:1px solid #ddd; }
        .details p { margin:6px 0; }
        h3 { margin-bottom:6px; }
        ul { margin:6px 0 12px 18px; }
      </style>
    </head>
    <body>
      {{#each reports}}
      <div class="bus-page">
        <div class="header">
          <h1>Bus Information for {{formattedMonth}}</h1>
          <h2>{{bus_number}}</h2>
        </div>

        {{#with BusDetailsData}}
          <div class="flex">
            {{#if imageUrl}}
              <img class="bus-img" src="{{imageUrl}}" />
            {{/if}}
            <div class="details">
              <p><strong>Bus Number:</strong> {{Bus_Number}}</p>
              <p><strong>TN Number:</strong> {{TN_Number}}</p>
              <p><strong>Registration Number:</strong> {{Registration_Number}}</p>
              <p><strong>FC Number:</strong> {{FC_Number}}</p>
              <p><strong>Insurance Number:</strong> {{Insurance_Number}}</p>
            </div>
          </div>
        {{/with}}

        <hr/>
        <h3>Distance & Mileage</h3>
        <p><strong>Total Distance:</strong> {{totalDistance}} km</p>
        <p><strong>Total Fuel:</strong> {{TotalFuel}} liters</p>
        <p><strong>Overall Mileage:</strong> {{overallMileage}} km/l</p>

        <h3>Fuel Summary</h3>
        <p><strong>Total Fuel Used:</strong> {{TotalFuel}} litres</p>
        <p><strong>Total Fuel Amount:</strong> ₹{{TotalFuelAmount}}</p>

        <h3>Service Summary</h3>
        <ul>
          {{#each serviceDetails}}
            <li>{{this.type}} - ₹{{this.amount}}</li>
          {{/each}}
        </ul>
        <p><b>Total Service Amount:</b> ₹{{TotalServiceAmount}}</p>

        <h3>Overall Expense</h3>
        <p>₹{{totalExpense}}</p>
      </div>
      {{/each}}
    </body>
    </html>
  `;

  const compiled = Handlebars.compile(templateHtml);
  const html = compiled({ reports, formattedMonth });

  const launchOptions = {
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-dev-shm-usage",
    ],
  };

  const browser = await puppeteer.launch(launchOptions);
  const page = await browser.newPage();
  await page.setContent(html, { waitUntil: "networkidle0" });
  const pdfBuffer = await page.pdf({
    format: "A4",
    printBackground: true,
    margin: { top: "20mm", bottom: "20mm" },
  });
  await browser.close();
  return pdfBuffer;
}

// --------- Send email ----------
async function sendEmail(pdfBuffer, adminEmail, formattedMonth) {
  const mailOptions = {
    from: process.env.SENDER_EMAIL,
    to: adminEmail,
    subject: `Monthly Bus Reports - ${formattedMonth}`,
    text: `Please find attached the bus report for ${formattedMonth}.`,
    attachments: [
      { filename: `BusReports-${formattedMonth}.pdf`, content: pdfBuffer },
    ],
  };

  const info = await transporter.sendMail(mailOptions);
  return info;
}

async function generateAndSendReport(year, month, adminEmail) {
  try {
    const { selectedMonth, formattedMonth } = getFormattedMonth(year, month);

    console.log(`Generating report for ${formattedMonth}`);

    const allData = await fetchAllCollectionsOnce();
    const reports = await buildReports(allData, selectedMonth, formattedMonth);

    if (!reports.length) {
      console.log("No data for this month.");
      return { success: false };
    }

    const pdfBuffer = await generatePdfBuffer(reports, formattedMonth);

    console.log(`Sending email to ${adminEmail}`);
    const info = await sendEmail(pdfBuffer, adminEmail, formattedMonth);

    console.log("Sent mail:", info.messageId || info.response);

    return { success: true, info };
  } catch (err) {
    console.error("Backend Error:", err);
    throw err;
  }
}

module.exports = { generateAndSendReport };
