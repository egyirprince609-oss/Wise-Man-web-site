const express = require("express");
const crypto = require("crypto");

const app = express();
const PORT = process.env.PORT || 10000;

app.use(express.json({ limit: "100kb" }));
app.use(express.urlencoded({ extended: false, limit: "100kb" }));

const NETPULSE_BASE_URL = "https://netpluse.shop/api/v1";
const NETPULSE_API_KEY = process.env.NETPULSE_API_KEY || "";

// ---------- Basic helpers ----------

function normalizePhone(phone = "") {
  const value = String(phone).trim();

  if (/^0\d{9}$/.test(value)) return value;
  if (/^233\d{9}$/.test(value)) return "0" + value.slice(3);
  if (/^\+233\d{9}$/.test(value)) return "0" + value.slice(4);

  return value;
}

function parseInputs(value = "") {
  const text = String(value || "").trim();

  if (!text) return [];

  // Some USSD gateways send the complete dial string on the first request.
  // Treat it as an empty menu input.
  if (text.startsWith("*") && text.endsWith("#")) return [];

  return text.split("*").map(x => x.trim()).filter(Boolean);
}

function responseFor(req, sessionID, userID, msisdn, message, continueSession) {
  // Current Arkesel documentation describes JSON callbacks.
  // The newer public USSD page also documents CON/END text responses.
  // We support both so the same backend is flexible during testing.
  const wantsJson =
    req.is("application/json") ||
    req.body?.sessionID !== undefined ||
    req.body?.newSession !== undefined ||
    req.body?.userData !== undefined;

  if (wantsJson) {
    return {
      sessionID: sessionID || "",
      userID: userID || "",
      msisdn: msisdn || "",
      message,
      continueSession
    };
  }

  return `${continueSession ? "CON" : "END"} ${message}`;
}

function sendUSSD(req, res, data) {
  if (typeof data === "object") {
    res.type("application/json").status(200).send(data);
  } else {
    res.type("text/plain").status(200).send(data);
  }
}

// ---------- Health ----------

app.get("/", (req, res) => {
  res.json({
    ok: true,
    service: "Wise Man USSD",
    status: "online"
  });
});

app.get("/health", (req, res) => {
  res.json({ ok: true });
});

// ---------- NetPulse ----------

async function getPackages() {
  if (!NETPULSE_API_KEY) {
    throw new Error("NETPULSE_API_KEY is not configured");
  }

  const response = await fetch(`${NETPULSE_BASE_URL}/packages`, {
    method: "GET",
    headers: {
      "x-api-key": NETPULSE_API_KEY,
      "Accept": "application/json"
    }
  });

  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    const error = data?.error || `NetPulse returned HTTP ${response.status}`;
    throw new Error(error);
  }

  return Array.isArray(data.packages) ? data.packages : [];
}

// ---------- USSD ----------

app.post("/ussd", async (req, res) => {
  const body = req.body || {};

  // Arkesel has documented two payload styles over time.
  const sessionID = body.sessionID || body.sessionId || "";
  const userID = body.userID || "";
  const msisdn = body.msisdn || body.phoneNumber || "";
  const network = String(body.network || "").toUpperCase();

  const rawInput =
    body.userData !== undefined
      ? body.userData
      : body.text !== undefined
        ? body.text
        : "";

  const inputs = parseInputs(rawInput);

  // First menu
  if (inputs.length === 0) {
    return sendUSSD(
      req,
      res,
      responseFor(
        req,
        sessionID,
        userID,
        msisdn,
        "WISE MAN DATA\n1. Buy Data\n2. Prices\n3. Help\n0. Exit",
        true
      )
    );
  }

  const first = inputs[0];

  // Exit
  if (first === "0") {
    return sendUSSD(
      req,
      res,
      responseFor(req, sessionID, userID, msisdn, "Thank you for using Wise Man Data.", false)
    );
  }

  // Prices
  if (first === "2") {
    try {
      const packages = await getPackages();

      if (!packages.length) {
        return sendUSSD(
          req,
          res,
          responseFor(req, sessionID, userID, msisdn, "Prices are temporarily unavailable. Please try again.", false)
        );
      }

      const lines = packages
        .slice(0, 6)
        .map((p, i) => `${i + 1}. ${p.network} ${p.capacity} GHS ${Number(p.price).toFixed(2)}`);

      const message = `DATA PRICES\n${lines.join("\n")}\n0. Back`;

      return sendUSSD(
        req,
        res,
        responseFor(req, sessionID, userID, msisdn, message, true)
      );
    } catch (error) {
      console.error("Price lookup failed:", error.message);
      return sendUSSD(
        req,
        res,
        responseFor(req, sessionID, userID, msisdn, "Unable to load prices now. Please try again.", false)
      );
    }
  }

  // Help
  if (first === "3") {
    return sendUSSD(
      req,
      res,
      responseFor(
        req,
        sessionID,
        userID,
        msisdn,
        "HELP\nBuy Data: choose network, bundle and recipient number.\nSupport: Wise Man",
        false
      )
    );
  }

  // Buy Data -> network
  if (first === "1" && inputs.length === 1) {
    return sendUSSD(
      req,
      res,
      responseFor(
        req,
        sessionID,
        userID,
        msisdn,
        "SELECT NETWORK\n1. MTN\n2. Telecel\n3. AirtelTigo\n0. Back",
        true
      )
    );
  }

  // Network selected -> show available bundles for that network.
  if (first === "1" && inputs.length === 2) {
    const networkChoice = inputs[1];

    if (networkChoice === "0") {
      return sendUSSD(
        req,
        res,
        responseFor(req, sessionID, userID, msisdn, "WISE MAN DATA\n1. Buy Data\n2. Prices\n3. Help\n0. Exit", true)
      );
    }

    const networkMap = {
      "1": "MTN",
      "2": "Telecel",
      "3": "AirtelTigo"
    };

    const selectedNetwork = networkMap[networkChoice];

    if (!selectedNetwork) {
      return sendUSSD(
        req,
        res,
        responseFor(req, sessionID, userID, msisdn, "Invalid network. Try again.", false)
      );
    }

    try {
      const packages = await getPackages();
      const matching = packages.filter(
        p => String(p.network).toUpperCase() === selectedNetwork
      );

      if (!matching.length) {
        return sendUSSD(
          req,
          res,
          responseFor(req, sessionID, userID, msisdn, `${selectedNetwork} bundles unavailable right now.`, false)
        );
      }

      const shown = matching.slice(0, 7);
      const lines = shown.map(
        (p, i) => `${i + 1}. ${p.capacity} GHS ${Number(p.price).toFixed(2)}`
      );

      // NOTE: At this stage this is deliberately browse-only.
      // Payment and NetPulse purchase will be added after the MoMo/payment flow.
      lines.push("0. Back");

      return sendUSSD(
        req,
        res,
        responseFor(
          req,
          sessionID,
          userID,
          msisdn,
          `${selectedNetwork} DATA\n${lines.join("\n")}`,
          true
        )
      );
    } catch (error) {
      console.error("Bundle lookup failed:", error.message);
      return sendUSSD(
        req,
        res,
        responseFor(req, sessionID, userID, msisdn, "Bundles are temporarily unavailable.", false)
      );
    }
  }

  // Bundle selected -> show the next stage, but DO NOT purchase yet.
  if (first === "1" && inputs.length === 3) {
    const networkMap = { "1": "MTN", "2": "Telecel", "3": "AirtelTigo" };
    const selectedNetwork = networkMap[inputs[1]];

    if (!selectedNetwork) {
      return sendUSSD(
        req,
        res,
        responseFor(req, sessionID, userID, msisdn, "Invalid network.", false)
      );
    }

    try {
      const packages = await getPackages();
      const matching = packages.filter(
        p => String(p.network).toUpperCase() === selectedNetwork
      );

      const index = Number(inputs[2]) - 1;
      const selected = matching[index];

      if (!selected) {
        return sendUSSD(
          req,
          res,
          responseFor(req, sessionID, userID, msisdn, "Invalid bundle. Please try again.", false)
        );
      }

      const message =
        `${selectedNetwork} ${selected.capacity} GHS ${Number(selected.price).toFixed(2)}\n` +
        `Enter recipient number:`;

      return sendUSSD(
        req,
        res,
        responseFor(req, sessionID, userID, msisdn, message, true)
      );
    } catch (error) {
      console.error("Bundle selection failed:", error.message);
      return sendUSSD(
        req,
        res,
        responseFor(req, sessionID, userID, msisdn, "Unable to check that bundle now.", false)
      );
    }
  }

  // Recipient entered -> confirmation screen.
  if (first === "1" && inputs.length === 4) {
    const networkMap = { "1": "MTN", "2": "Telecel", "3": "AirtelTigo" };
    const selectedNetwork = networkMap[inputs[1]];
    const recipient = normalizePhone(inputs[3]);

    if (!selectedNetwork || !/^0\d{9}$/.test(recipient)) {
      return sendUSSD(
        req,
        res,
        responseFor(req, sessionID, userID, msisdn, "Invalid recipient number. Use 0241234567 format.", false)
      );
    }

    try {
      const packages = await getPackages();
      const matching = packages.filter(
        p => String(p.network).toUpperCase() === selectedNetwork
      );
      const selected = matching[Number(inputs[2]) - 1];

      if (!selected) {
        return sendUSSD(
          req,
          res,
          responseFor(req, sessionID, userID, msisdn, "Bundle not found. Please start again.", false)
        );
      }

      const message =
        `CONFIRM\n${selectedNetwork} ${selected.capacity}\n` +
        `To: ${recipient}\n` +
        `Price: GHS ${Number(selected.price).toFixed(2)}\n` +
        `1. Continue\n2. Cancel`;

      return sendUSSD(
        req,
        res,
        responseFor(req, sessionID, userID, msisdn, message, true)
      );
    } catch (error) {
      console.error("Confirmation lookup failed:", error.message);
      return sendUSSD(
        req,
        res,
        responseFor(req, sessionID, userID, msisdn, "Unable to prepare confirmation.", false)
      );
    }
  }

  // Payment will be connected here in the next phase.
  if (first === "1" && inputs.length === 5) {
    if (inputs[4] === "2") {
      return sendUSSD(
        req,
        res,
        responseFor(req, sessionID, userID, msisdn, "Purchase cancelled.", false)
      );
    }

    if (inputs[4] === "1") {
      return sendUSSD(
        req,
        res,
        responseFor(
          req,
          sessionID,
          userID,
          msisdn,
          "Payment is not connected yet. This test build will not charge or purchase data.",
          false
        )
      );
    }
  }

  return sendUSSD(
    req,
    res,
    responseFor(req, sessionID, userID, msisdn, "Invalid option. Please dial again.", false)
  );
});

// ---------- Start ----------

app.listen(PORT, "0.0.0.0", () => {
  console.log(`Wise Man USSD server listening on 0.0.0.0:${PORT}`);
});