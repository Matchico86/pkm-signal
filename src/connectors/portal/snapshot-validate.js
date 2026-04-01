const CARD_ID_PATTERN = /^[A-Za-z0-9._:/-]+$/;
const REQUIRED_BLOCKS = [
  "purchase_items",
  "sales_items",
  "stock_live",
  "purchase_orders",
  "sales_orders",
];

const OPTIONAL_BLOCKS = ["orders_status"];

class ValidationError extends Error {}

class WarningCollector {
  constructor() {
    this.map = new Map();
  }

  add({ code, block = "global", message, sample }) {
    const key = `${code}|${block}|${message}`;
    let entry = this.map.get(key);
    if (!entry) {
      entry = {
        code,
        block,
        message,
        count: 0,
        samples: [],
      };
      this.map.set(key, entry);
    }

    entry.count += 1;

    if (sample === undefined || entry.samples.length >= 5) {
      return;
    }

    const normalizedSample =
      typeof sample === "string" ? sample : JSON.stringify(sample);

    if (!entry.samples.includes(normalizedSample)) {
      entry.samples.push(normalizedSample);
    }
  }

  toArray() {
    return Array.from(this.map.values()).sort((left, right) => {
      if (left.block !== right.block) {
        return left.block.localeCompare(right.block);
      }

      if (left.code !== right.code) {
        return left.code.localeCompare(right.code);
      }

      return left.message.localeCompare(right.message);
    });
  }
}

function normalizeString(value) {
  if (value === null || value === undefined) {
    return null;
  }

  const normalized = String(value).trim();
  return normalized === "" ? null : normalized;
}

function getField(rawRow, candidates) {
  for (const candidate of candidates) {
    if (Object.prototype.hasOwnProperty.call(rawRow, candidate)) {
      return rawRow[candidate];
    }
  }
  return undefined;
}

function parsePayloadJson(payloadText, payloadOrigin = "payload") {
  if (normalizeString(payloadText) === null) {
    throw new ValidationError(`Portal snapshot payload is empty (${payloadOrigin}).`);
  }

  let parsed;
  try {
    parsed = JSON.parse(payloadText);
  } catch (error) {
    throw new ValidationError(`Invalid JSON in ${payloadOrigin}: ${error.message}`);
  }

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new ValidationError(
      `Invalid snapshot payload in ${payloadOrigin}: expected a JSON object.`
    );
  }

  return parsed;
}

function parseIsoDateTime(value) {
  const normalized = normalizeString(value);
  if (!normalized) {
    return null;
  }

  const parsedTimestamp = Date.parse(normalized);
  if (Number.isNaN(parsedTimestamp)) {
    return null;
  }

  return new Date(parsedTimestamp).toISOString();
}

function parseSourceRow(value, block, rowIndex, warnings) {
  if (value === null || value === undefined || value === "") {
    return null;
  }

  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    warnings.add({
      code: "INVALID_SOURCE_ROW",
      block,
      message: "_source_row must be a positive integer when provided.",
      sample: { row_index: rowIndex, value },
    });
    return null;
  }

  return parsed;
}

function parseBooleanOrNull(value, block, rowIndex, fieldName, warnings) {
  if (value === null || value === undefined || value === "") {
    return null;
  }

  if (typeof value === "boolean") {
    return value;
  }

  if (typeof value === "number") {
    if (value === 1) {
      return true;
    }
    if (value === 0) {
      return false;
    }
  }

  const normalized = normalizeString(value);
  if (!normalized) {
    return null;
  }

  const lowered = normalized.toLowerCase();
  if (["true", "yes", "y", "1", "ok", "received"].includes(lowered)) {
    return true;
  }
  if (["false", "no", "n", "0", "ko", "pending"].includes(lowered)) {
    return false;
  }

  warnings.add({
    code: "INVALID_BOOLEAN",
    block,
    message: `${fieldName} could not be normalized to boolean, kept as null.`,
    sample: { row_index: rowIndex, value },
  });
  return null;
}

function parseNumberOrNull(value, block, rowIndex, fieldName, warnings) {
  if (value === null || value === undefined || value === "") {
    return { value: null, isEmpty: true, isValid: true };
  }

  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    warnings.add({
      code: "INVALID_NUMBER",
      block,
      message: `${fieldName} could not be normalized to number, kept as null.`,
      sample: { row_index: rowIndex, value },
    });
    return { value: null, isEmpty: false, isValid: false };
  }

  return { value: parsed, isEmpty: false, isValid: true };
}

function normalizeOwner(rawValue, block, rowIndex, warnings, { required = false } = {}) {
  const normalized = normalizeString(rawValue);
  if (!normalized) {
    return required ? null : null;
  }

  const upper = normalized.toUpperCase();
  if (upper === "MAT" || upper === "MATHIEU") {
    return "MAT";
  }
  if (upper === "EWA" || upper === "EWAN") {
    return "EWA";
  }

  warnings.add({
    code: "UNKNOWN_OWNER",
    block,
    message: "Owner is outside MAT/EWA.",
    sample: { row_index: rowIndex, owner: normalized },
  });
  return upper;
}

function validateRequiredText(rawValue, fieldName, issues) {
  const normalized = normalizeString(rawValue);
  if (!normalized) {
    issues.push(`missing required field ${fieldName}`);
    return null;
  }
  return normalized;
}

function warnCardIdPattern(cardId, block, rowIndex, warnings) {
  if (!cardId) {
    return;
  }

  if (!CARD_ID_PATTERN.test(cardId)) {
    warnings.add({
      code: "CARD_ID_FORMAT_UNUSUAL",
      block,
      message: "CARD_ID contains unusual characters.",
      sample: { row_index: rowIndex, card_id: cardId },
    });
  }
}

function validateSnapshotEnvelope(snapshotPayload, warnings) {
  const schemaVersionRaw = snapshotPayload.schema_version;
  if (schemaVersionRaw === null || schemaVersionRaw === undefined) {
    throw new ValidationError("Missing required field: schema_version");
  }

  const schemaVersion = Number(schemaVersionRaw);
  if (!Number.isInteger(schemaVersion)) {
    throw new ValidationError(`Invalid schema_version: ${schemaVersionRaw}`);
  }
  if (schemaVersion !== 1) {
    throw new ValidationError(`Unsupported schema_version=${schemaVersion}. Expected 1.`);
  }

  const exportedAtRaw = snapshotPayload.exported_at;
  if (exportedAtRaw === null || exportedAtRaw === undefined || exportedAtRaw === "") {
    throw new ValidationError("Missing required field: exported_at");
  }

  const exportedAt = parseIsoDateTime(exportedAtRaw);
  if (!exportedAt) {
    throw new ValidationError(`Invalid exported_at datetime: ${exportedAtRaw}`);
  }

  const sourceName = normalizeString(snapshotPayload.source) || "PKM Portal";

  let meta = snapshotPayload.meta;
  if (meta === undefined) {
    meta = {};
  } else if (meta === null) {
    meta = {};
  } else if (typeof meta !== "object" || Array.isArray(meta)) {
    warnings.add({
      code: "INVALID_META",
      block: "global",
      message: "meta should be an object. Value ignored.",
    });
    meta = {};
  }

  let portalWarnings = snapshotPayload.warnings;
  if (portalWarnings === undefined || portalWarnings === null) {
    portalWarnings = [];
  } else if (!Array.isArray(portalWarnings)) {
    warnings.add({
      code: "INVALID_SOURCE_WARNINGS",
      block: "global",
      message: "warnings should be an array. Value ignored.",
    });
    portalWarnings = [];
  } else if (portalWarnings.length > 0) {
    warnings.add({
      code: "SOURCE_WARNINGS_PRESENT",
      block: "global",
      message: "Portal snapshot payload contains source warnings.",
      sample: {
        warning_count: portalWarnings.length,
      },
    });
  }

  const blocks = {};

  for (const blockName of REQUIRED_BLOCKS) {
    if (!Object.prototype.hasOwnProperty.call(snapshotPayload, blockName)) {
      throw new ValidationError(`Missing required block: ${blockName}`);
    }

    if (!Array.isArray(snapshotPayload[blockName])) {
      throw new ValidationError(`Invalid block ${blockName}: expected an array.`);
    }

    blocks[blockName] = snapshotPayload[blockName];
    if (blocks[blockName].length === 0) {
      warnings.add({
        code: "EMPTY_BLOCK",
        block: blockName,
        message: "Required block is present but empty.",
      });
    }
  }

  for (const blockName of OPTIONAL_BLOCKS) {
    if (!Object.prototype.hasOwnProperty.call(snapshotPayload, blockName)) {
      blocks[blockName] = [];
      warnings.add({
        code: "OPTIONAL_BLOCK_MISSING",
        block: blockName,
        message: "Optional block missing; treated as empty.",
      });
      continue;
    }

    if (!Array.isArray(snapshotPayload[blockName])) {
      blocks[blockName] = [];
      warnings.add({
        code: "INVALID_OPTIONAL_BLOCK",
        block: blockName,
        message: "Optional block is not an array; ignored as empty.",
      });
      continue;
    }

    blocks[blockName] = snapshotPayload[blockName];
  }

  return {
    schemaVersion,
    exportedAt,
    sourceName,
    meta,
    portalWarnings,
    blocks,
  };
}

function buildRowIssue(block, rowIndex, issues, warnings, rawRow) {
  if (issues.length === 0) {
    return false;
  }

  warnings.add({
    code: "ROW_REJECTED",
    block,
    message: "Row rejected by validation.",
    sample: {
      row_index: rowIndex,
      issues,
      raw: rawRow,
    },
  });
  return true;
}
function validatePurchaseItems(rows, warnings) {
  const block = "purchase_items";
  const validRows = [];
  let invalidRows = 0;
  const seenPItemIds = new Set();

  rows.forEach((rawRow, index) => {
    const rowIndex = index + 1;
    if (!rawRow || typeof rawRow !== "object" || Array.isArray(rawRow)) {
      invalidRows += 1;
      warnings.add({
        code: "ROW_NOT_OBJECT",
        block,
        message: "Row must be a JSON object.",
        sample: { row_index: rowIndex },
      });
      return;
    }

    const issues = [];
    const pItemId = validateRequiredText(
      getField(rawRow, ["P_ITEM_ID", "p_item_id", "pItemId"]),
      "P_ITEM_ID",
      issues
    );
    const pOrderId = validateRequiredText(
      getField(rawRow, ["P_ORDER_ID", "p_order_id", "pOrderId"]),
      "P_ORDER_ID",
      issues
    );
    const cardId = validateRequiredText(
      getField(rawRow, ["CARD_ID", "card_id", "cardId"]),
      "CARD_ID",
      issues
    );
    const owner = normalizeOwner(
      getField(rawRow, ["Owner", "owner"]),
      block,
      rowIndex,
      warnings,
      { required: true }
    );
    if (!owner) {
      issues.push("missing required field Owner");
    }

    if (pItemId && seenPItemIds.has(pItemId)) {
      issues.push(`duplicate critical key P_ITEM_ID=${pItemId}`);
      warnings.add({
        code: "DUPLICATE_CRITICAL_KEY",
        block,
        message: "Duplicate P_ITEM_ID in snapshot.",
        sample: { row_index: rowIndex, p_item_id: pItemId },
      });
    }

    const pQuantityField = parseNumberOrNull(
      getField(rawRow, ["P_quantity", "p_quantity", "pQuantity"]),
      block,
      rowIndex,
      "P_quantity",
      warnings
    );
    if (!pQuantityField.isEmpty && !pQuantityField.isValid) {
      issues.push("P_quantity must be numeric when non-empty");
    }
    if (pQuantityField.value !== null && pQuantityField.value < 0) {
      issues.push("P_quantity cannot be negative");
      warnings.add({
        code: "NEGATIVE_QUANTITY",
        block,
        message: "Negative quantity detected.",
        sample: { row_index: rowIndex, field: "P_quantity", value: pQuantityField.value },
      });
    }

    const qtySoldField = parseNumberOrNull(
      getField(rawRow, ["Qty_sold", "qty_sold", "qtySold"]),
      block,
      rowIndex,
      "Qty_sold",
      warnings
    );
    if (qtySoldField.value !== null && qtySoldField.value < 0) {
      issues.push("Qty_sold cannot be negative");
      warnings.add({
        code: "NEGATIVE_QUANTITY",
        block,
        message: "Negative quantity detected.",
        sample: { row_index: rowIndex, field: "Qty_sold", value: qtySoldField.value },
      });
    }

    const qtyRemainingField = parseNumberOrNull(
      getField(rawRow, ["Qty_remaining", "qty_remaining", "qtyRemaining"]),
      block,
      rowIndex,
      "Qty_remaining",
      warnings
    );
    if (qtyRemainingField.value !== null && qtyRemainingField.value < 0) {
      issues.push("Qty_remaining cannot be negative");
      warnings.add({
        code: "NEGATIVE_QUANTITY",
        block,
        message: "Negative quantity detected.",
        sample: {
          row_index: rowIndex,
          field: "Qty_remaining",
          value: qtyRemainingField.value,
        },
      });
    }

    const qtyForSaleField = parseNumberOrNull(
      getField(rawRow, ["Qty_for_sale", "qty_for_sale", "qtyForSale"]),
      block,
      rowIndex,
      "Qty_for_sale",
      warnings
    );
    if (qtyForSaleField.value !== null && qtyForSaleField.value < 0) {
      issues.push("Qty_for_sale cannot be negative");
      warnings.add({
        code: "NEGATIVE_QUANTITY",
        block,
        message: "Negative quantity detected.",
        sample: {
          row_index: rowIndex,
          field: "Qty_for_sale",
          value: qtyForSaleField.value,
        },
      });
    }

    const pPriceItemField = parseNumberOrNull(
      getField(rawRow, ["P_price_item", "p_price_item", "pPriceItem"]),
      block,
      rowIndex,
      "P_price_item",
      warnings
    );
    if (pPriceItemField.value !== null && pPriceItemField.value < 0) {
      issues.push("P_price_item cannot be negative");
      warnings.add({
        code: "NEGATIVE_PRICE",
        block,
        message: "Negative price detected.",
        sample: {
          row_index: rowIndex,
          field: "P_price_item",
          value: pPriceItemField.value,
        },
      });
    }

    const received = parseBooleanOrNull(
      getField(rawRow, ["Received", "received"]),
      block,
      rowIndex,
      "Received",
      warnings
    );

    if (buildRowIssue(block, rowIndex, issues, warnings, rawRow)) {
      invalidRows += 1;
      return;
    }

    seenPItemIds.add(pItemId);
    warnCardIdPattern(cardId, block, rowIndex, warnings);

    if (
      pQuantityField.value !== null &&
      qtySoldField.value !== null &&
      qtySoldField.value > pQuantityField.value
    ) {
      warnings.add({
        code: "QUANTITY_COHERENCE",
        block,
        message: "Qty_sold is greater than P_quantity.",
        sample: {
          row_index: rowIndex,
          p_item_id: pItemId,
          p_quantity: pQuantityField.value,
          qty_sold: qtySoldField.value,
        },
      });
    }

    if (
      pQuantityField.value !== null &&
      qtySoldField.value !== null &&
      qtyRemainingField.value !== null &&
      Math.abs(pQuantityField.value - (qtySoldField.value + qtyRemainingField.value)) > 0.00001
    ) {
      warnings.add({
        code: "QUANTITY_COHERENCE",
        block,
        message: "P_quantity differs from Qty_sold + Qty_remaining.",
        sample: {
          row_index: rowIndex,
          p_item_id: pItemId,
          p_quantity: pQuantityField.value,
          qty_sold: qtySoldField.value,
          qty_remaining: qtyRemainingField.value,
        },
      });
    }

    if (
      qtyRemainingField.value !== null &&
      qtyForSaleField.value !== null &&
      qtyForSaleField.value > qtyRemainingField.value
    ) {
      warnings.add({
        code: "QUANTITY_COHERENCE",
        block,
        message: "Qty_for_sale is greater than Qty_remaining.",
        sample: {
          row_index: rowIndex,
          p_item_id: pItemId,
          qty_remaining: qtyRemainingField.value,
          qty_for_sale: qtyForSaleField.value,
        },
      });
    }

    validRows.push({
      rowIndex,
      pItemId,
      pOrderId,
      cardId,
      owner,
      pQuantity: pQuantityField.value,
      qtySold: qtySoldField.value,
      qtyRemaining: qtyRemainingField.value,
      qtyForSale: qtyForSaleField.value,
      pPriceItem: pPriceItemField.value,
      received,
      sourceSheet:
        normalizeString(getField(rawRow, ["_source_sheet", "Source_sheet", "source_sheet"])) ||
        null,
      sourceRow: parseSourceRow(
        getField(rawRow, ["_source_row", "Source_row", "source_row"]),
        block,
        rowIndex,
        warnings
      ),
      raw: rawRow,
    });
  });

  return {
    rowsRead: rows.length,
    rowsValid: validRows.length,
    rowsInvalid: invalidRows,
    rows: validRows,
  };
}

function validateSalesItems(rows, warnings) {
  const block = "sales_items";
  const validRows = [];
  let invalidRows = 0;
  const seenSItemIds = new Set();

  rows.forEach((rawRow, index) => {
    const rowIndex = index + 1;
    if (!rawRow || typeof rawRow !== "object" || Array.isArray(rawRow)) {
      invalidRows += 1;
      warnings.add({
        code: "ROW_NOT_OBJECT",
        block,
        message: "Row must be a JSON object.",
        sample: { row_index: rowIndex },
      });
      return;
    }

    const issues = [];
    const sItemId = validateRequiredText(
      getField(rawRow, ["S_ITEM_ID", "s_item_id", "sItemId"]),
      "S_ITEM_ID",
      issues
    );
    const sOrderId = validateRequiredText(
      getField(rawRow, ["S_ORDER_ID", "s_order_id", "sOrderId"]),
      "S_ORDER_ID",
      issues
    );
    const cardId = validateRequiredText(
      getField(rawRow, ["CARD_ID", "card_id", "cardId"]),
      "CARD_ID",
      issues
    );
    const owner = normalizeOwner(
      getField(rawRow, ["Owner", "owner"]),
      block,
      rowIndex,
      warnings,
      { required: true }
    );
    if (!owner) {
      issues.push("missing required field Owner");
    }

    if (sItemId && seenSItemIds.has(sItemId)) {
      issues.push(`duplicate critical key S_ITEM_ID=${sItemId}`);
      warnings.add({
        code: "DUPLICATE_CRITICAL_KEY",
        block,
        message: "Duplicate S_ITEM_ID in snapshot.",
        sample: { row_index: rowIndex, s_item_id: sItemId },
      });
    }

    const sQuantityField = parseNumberOrNull(
      getField(rawRow, ["S_quantity", "s_quantity", "sQuantity"]),
      block,
      rowIndex,
      "S_quantity",
      warnings
    );
    if (!sQuantityField.isEmpty && !sQuantityField.isValid) {
      issues.push("S_quantity must be numeric when non-empty");
    }
    if (sQuantityField.value !== null && sQuantityField.value < 0) {
      issues.push("S_quantity cannot be negative");
      warnings.add({
        code: "NEGATIVE_QUANTITY",
        block,
        message: "Negative quantity detected.",
        sample: { row_index: rowIndex, field: "S_quantity", value: sQuantityField.value },
      });
    }

    const sPriceField = parseNumberOrNull(
      getField(rawRow, ["S_price_item", "s_price_item", "sPriceItem"]),
      block,
      rowIndex,
      "S_price_item",
      warnings
    );
    if (sPriceField.value !== null && sPriceField.value < 0) {
      issues.push("S_price_item cannot be negative");
      warnings.add({
        code: "NEGATIVE_PRICE",
        block,
        message: "Negative price detected.",
        sample: { row_index: rowIndex, field: "S_price_item", value: sPriceField.value },
      });
    }

    const marginField = parseNumberOrNull(
      getField(rawRow, ["Margin_item", "margin_item", "marginItem"]),
      block,
      rowIndex,
      "Margin_item",
      warnings
    );

    const roiField = parseNumberOrNull(
      getField(rawRow, ["ROI_item", "roi_item", "roiItem"]),
      block,
      rowIndex,
      "ROI_item",
      warnings
    );

    if (buildRowIssue(block, rowIndex, issues, warnings, rawRow)) {
      invalidRows += 1;
      return;
    }

    seenSItemIds.add(sItemId);
    warnCardIdPattern(cardId, block, rowIndex, warnings);

    validRows.push({
      rowIndex,
      sItemId,
      sOrderId,
      pItemId: normalizeString(getField(rawRow, ["P_ITEM_ID", "p_item_id", "pItemId"])),
      cardId,
      owner,
      sQuantity: sQuantityField.value,
      sPriceItem: sPriceField.value,
      marginItem: marginField.value,
      roiItem: roiField.value,
      sourceSheet:
        normalizeString(getField(rawRow, ["_source_sheet", "Source_sheet", "source_sheet"])) ||
        null,
      sourceRow: parseSourceRow(
        getField(rawRow, ["_source_row", "Source_row", "source_row"]),
        block,
        rowIndex,
        warnings
      ),
      raw: rawRow,
    });
  });

  return {
    rowsRead: rows.length,
    rowsValid: validRows.length,
    rowsInvalid: invalidRows,
    rows: validRows,
  };
}
function validateStockLive(rows, warnings) {
  const block = "stock_live";
  const validRows = [];
  let invalidRows = 0;

  rows.forEach((rawRow, index) => {
    const rowIndex = index + 1;
    if (!rawRow || typeof rawRow !== "object" || Array.isArray(rawRow)) {
      invalidRows += 1;
      warnings.add({
        code: "ROW_NOT_OBJECT",
        block,
        message: "Row must be a JSON object.",
        sample: { row_index: rowIndex },
      });
      return;
    }

    const issues = [];
    const cardId = validateRequiredText(
      getField(rawRow, ["CARD_ID", "card_id", "cardId"]),
      "CARD_ID",
      issues
    );

    const quantityField = parseNumberOrNull(
      getField(rawRow, ["Quantity", "quantity"]),
      block,
      rowIndex,
      "Quantity",
      warnings
    );
    if (!quantityField.isEmpty && !quantityField.isValid) {
      issues.push("Quantity must be numeric when non-empty");
    }
    if (quantityField.value !== null && quantityField.value < 0) {
      issues.push("Quantity cannot be negative");
      warnings.add({
        code: "NEGATIVE_QUANTITY",
        block,
        message: "Negative quantity detected.",
        sample: { row_index: rowIndex, field: "Quantity", value: quantityField.value },
      });
    }

    const qtyMathieuField = parseNumberOrNull(
      getField(rawRow, ["Qty_Mathieu", "qty_mathieu", "qtyMathieu"]),
      block,
      rowIndex,
      "Qty_Mathieu",
      warnings
    );
    if (qtyMathieuField.value !== null && qtyMathieuField.value < 0) {
      issues.push("Qty_Mathieu cannot be negative");
      warnings.add({
        code: "NEGATIVE_QUANTITY",
        block,
        message: "Negative quantity detected.",
        sample: { row_index: rowIndex, field: "Qty_Mathieu", value: qtyMathieuField.value },
      });
    }

    const qtyEwanField = parseNumberOrNull(
      getField(rawRow, ["Qty_Ewan", "qty_ewan", "qtyEwan"]),
      block,
      rowIndex,
      "Qty_Ewan",
      warnings
    );
    if (qtyEwanField.value !== null && qtyEwanField.value < 0) {
      issues.push("Qty_Ewan cannot be negative");
      warnings.add({
        code: "NEGATIVE_QUANTITY",
        block,
        message: "Negative quantity detected.",
        sample: { row_index: rowIndex, field: "Qty_Ewan", value: qtyEwanField.value },
      });
    }

    if (buildRowIssue(block, rowIndex, issues, warnings, rawRow)) {
      invalidRows += 1;
      return;
    }

    warnCardIdPattern(cardId, block, rowIndex, warnings);

    if (
      quantityField.value !== null &&
      qtyMathieuField.value !== null &&
      qtyEwanField.value !== null &&
      Math.abs(quantityField.value - (qtyMathieuField.value + qtyEwanField.value)) > 0.00001
    ) {
      warnings.add({
        code: "QUANTITY_COHERENCE",
        block,
        message: "Quantity differs from Qty_Mathieu + Qty_Ewan.",
        sample: {
          row_index: rowIndex,
          card_id: cardId,
          quantity: quantityField.value,
          qty_mathieu: qtyMathieuField.value,
          qty_ewan: qtyEwanField.value,
        },
      });
    }

    validRows.push({
      rowIndex,
      cardId,
      owner: normalizeOwner(
        getField(rawRow, ["Owner", "owner"]),
        block,
        rowIndex,
        warnings
      ),
      quantity: quantityField.value,
      qtyMathieu: qtyMathieuField.value,
      qtyEwan: qtyEwanField.value,
      sourceSheet:
        normalizeString(getField(rawRow, ["_source_sheet", "Source_sheet", "source_sheet"])) ||
        null,
      sourceRow: parseSourceRow(
        getField(rawRow, ["_source_row", "Source_row", "source_row"]),
        block,
        rowIndex,
        warnings
      ),
      raw: rawRow,
    });
  });

  return {
    rowsRead: rows.length,
    rowsValid: validRows.length,
    rowsInvalid: invalidRows,
    rows: validRows,
  };
}

function parseOrderAmount(rawRow, rowIndex, block, warnings, candidates, fieldName) {
  const parsed = parseNumberOrNull(getField(rawRow, candidates), block, rowIndex, fieldName, warnings);
  if (parsed.value !== null && parsed.value < 0) {
    warnings.add({
      code: "NEGATIVE_ORDER_AMOUNT",
      block,
      message: "Negative amount detected on order context.",
      sample: { row_index: rowIndex, field: fieldName, value: parsed.value },
    });
  }
  return parsed.value;
}

function validatePurchaseOrders(rows, warnings) {
  const block = "purchase_orders";
  const validRows = [];
  let invalidRows = 0;
  const seenOrderIds = new Set();

  rows.forEach((rawRow, index) => {
    const rowIndex = index + 1;
    if (!rawRow || typeof rawRow !== "object" || Array.isArray(rawRow)) {
      invalidRows += 1;
      warnings.add({
        code: "ROW_NOT_OBJECT",
        block,
        message: "Row must be a JSON object.",
        sample: { row_index: rowIndex },
      });
      return;
    }

    const issues = [];
    const pOrderId = validateRequiredText(
      getField(rawRow, ["P_ORDER_ID", "p_order_id", "pOrderId"]),
      "P_ORDER_ID",
      issues
    );
    const owner = normalizeOwner(
      getField(rawRow, ["Order_owner", "order_owner", "orderOwner"]),
      block,
      rowIndex,
      warnings,
      { required: true }
    );
    if (!owner) {
      issues.push("missing required field Order_owner");
    }

    if (pOrderId && seenOrderIds.has(pOrderId)) {
      issues.push(`duplicate critical key P_ORDER_ID=${pOrderId}`);
      warnings.add({
        code: "DUPLICATE_CRITICAL_KEY",
        block,
        message: "Duplicate P_ORDER_ID in snapshot.",
        sample: { row_index: rowIndex, p_order_id: pOrderId },
      });
    }

    const sourceSheet =
      normalizeString(getField(rawRow, ["Source_sheet", "_source_sheet", "source_sheet"])) ||
      null;
    if (!sourceSheet) {
      warnings.add({
        code: "RECOMMENDED_FIELD_MISSING",
        block,
        message: "Source_sheet is recommended for order context.",
        sample: { row_index: rowIndex, p_order_id: pOrderId || null },
      });
    }

    if (buildRowIssue(block, rowIndex, issues, warnings, rawRow)) {
      invalidRows += 1;
      return;
    }

    seenOrderIds.add(pOrderId);

    validRows.push({
      rowIndex,
      pOrderId,
      orderOwner: owner,
      totalAmount: parseOrderAmount(
        rawRow,
        rowIndex,
        block,
        warnings,
        ["Total", "total", "Total_amount", "total_amount", "Amount_total", "amount_total"],
        "total_amount"
      ),
      shippingAmount: parseOrderAmount(
        rawRow,
        rowIndex,
        block,
        warnings,
        ["Shipping", "shipping", "Shipping_amount", "shipping_amount"],
        "shipping_amount"
      ),
      feesAmount: parseOrderAmount(
        rawRow,
        rowIndex,
        block,
        warnings,
        ["Fees", "fees", "Fee", "fee", "Fees_amount", "fees_amount"],
        "fees_amount"
      ),
      sourceSheet,
      sourceRow: parseSourceRow(
        getField(rawRow, ["_source_row", "Source_row", "source_row"]),
        block,
        rowIndex,
        warnings
      ),
      raw: rawRow,
    });
  });

  return {
    rowsRead: rows.length,
    rowsValid: validRows.length,
    rowsInvalid: invalidRows,
    rows: validRows,
  };
}

function validateSalesOrders(rows, warnings) {
  const block = "sales_orders";
  const validRows = [];
  let invalidRows = 0;
  const seenOrderIds = new Set();

  rows.forEach((rawRow, index) => {
    const rowIndex = index + 1;
    if (!rawRow || typeof rawRow !== "object" || Array.isArray(rawRow)) {
      invalidRows += 1;
      warnings.add({
        code: "ROW_NOT_OBJECT",
        block,
        message: "Row must be a JSON object.",
        sample: { row_index: rowIndex },
      });
      return;
    }

    const issues = [];
    const sOrderId = validateRequiredText(
      getField(rawRow, ["S_ORDER_ID", "s_order_id", "sOrderId"]),
      "S_ORDER_ID",
      issues
    );
    const owner = normalizeOwner(
      getField(rawRow, ["Order_owner", "order_owner", "orderOwner"]),
      block,
      rowIndex,
      warnings,
      { required: true }
    );
    if (!owner) {
      issues.push("missing required field Order_owner");
    }

    if (sOrderId && seenOrderIds.has(sOrderId)) {
      issues.push(`duplicate critical key S_ORDER_ID=${sOrderId}`);
      warnings.add({
        code: "DUPLICATE_CRITICAL_KEY",
        block,
        message: "Duplicate S_ORDER_ID in snapshot.",
        sample: { row_index: rowIndex, s_order_id: sOrderId },
      });
    }

    const sourceSheet =
      normalizeString(getField(rawRow, ["Source_sheet", "_source_sheet", "source_sheet"])) ||
      null;
    if (!sourceSheet) {
      warnings.add({
        code: "RECOMMENDED_FIELD_MISSING",
        block,
        message: "Source_sheet is recommended for order context.",
        sample: { row_index: rowIndex, s_order_id: sOrderId || null },
      });
    }

    if (buildRowIssue(block, rowIndex, issues, warnings, rawRow)) {
      invalidRows += 1;
      return;
    }

    seenOrderIds.add(sOrderId);

    validRows.push({
      rowIndex,
      sOrderId,
      orderOwner: owner,
      totalAmount: parseOrderAmount(
        rawRow,
        rowIndex,
        block,
        warnings,
        ["Total", "total", "Total_amount", "total_amount", "Amount_total", "amount_total"],
        "total_amount"
      ),
      shippingAmount: parseOrderAmount(
        rawRow,
        rowIndex,
        block,
        warnings,
        ["Shipping", "shipping", "Shipping_amount", "shipping_amount"],
        "shipping_amount"
      ),
      feesAmount: parseOrderAmount(
        rawRow,
        rowIndex,
        block,
        warnings,
        ["Fees", "fees", "Fee", "fee", "Fees_amount", "fees_amount"],
        "fees_amount"
      ),
      sourceSheet,
      sourceRow: parseSourceRow(
        getField(rawRow, ["_source_row", "Source_row", "source_row"]),
        block,
        rowIndex,
        warnings
      ),
      raw: rawRow,
    });
  });

  return {
    rowsRead: rows.length,
    rowsValid: validRows.length,
    rowsInvalid: invalidRows,
    rows: validRows,
  };
}
function validateOrdersStatus(rows, warnings) {
  const block = "orders_status";
  const validRows = [];
  let invalidRows = 0;

  rows.forEach((rawRow, index) => {
    const rowIndex = index + 1;
    if (!rawRow || typeof rawRow !== "object" || Array.isArray(rawRow)) {
      invalidRows += 1;
      warnings.add({
        code: "ROW_NOT_OBJECT",
        block,
        message: "Row must be a JSON object.",
        sample: { row_index: rowIndex },
      });
      return;
    }

    const updatedAtRaw = getField(rawRow, [
      "Updated_At",
      "updated_at",
      "updatedAt",
      "Date_Updated",
      "date_updated",
    ]);
    let updatedAt = parseIsoDateTime(updatedAtRaw);
    if (updatedAtRaw !== undefined && updatedAtRaw !== null && updatedAtRaw !== "" && !updatedAt) {
      warnings.add({
        code: "INVALID_DATETIME",
        block,
        message: "Updated_At could not be normalized to ISO UTC.",
        sample: { row_index: rowIndex, value: updatedAtRaw },
      });
      updatedAt = null;
    }

    validRows.push({
      rowIndex,
      type: normalizeString(getField(rawRow, ["Type", "type"])),
      refId: normalizeString(getField(rawRow, ["Ref_ID", "ref_id", "refId"])),
      status: normalizeString(getField(rawRow, ["Status", "status"])),
      updatedAt,
      sourceSheet:
        normalizeString(getField(rawRow, ["_source_sheet", "Source_sheet", "source_sheet"])) ||
        null,
      sourceRow: parseSourceRow(
        getField(rawRow, ["_source_row", "Source_row", "source_row"]),
        block,
        rowIndex,
        warnings
      ),
      raw: rawRow,
    });
  });

  return {
    rowsRead: rows.length,
    rowsValid: validRows.length,
    rowsInvalid: invalidRows,
    rows: validRows,
  };
}

function applyCrossBlockCoherence(validatedBlocks, warnings) {
  const purchaseIds = new Set(validatedBlocks.purchaseItems.rows.map((row) => row.pItemId));
  for (const salesRow of validatedBlocks.salesItems.rows) {
    if (!salesRow.pItemId) {
      continue;
    }

    if (!purchaseIds.has(salesRow.pItemId)) {
      warnings.add({
        code: "UNKNOWN_PURCHASE_LINK",
        block: "sales_items",
        message: "sales_items row references unknown P_ITEM_ID.",
        sample: {
          s_item_id: salesRow.sItemId,
          p_item_id: salesRow.pItemId,
        },
      });
    }
  }
}

function validatePortalSnapshot(snapshotPayload) {
  const warnings = new WarningCollector();
  const envelope = validateSnapshotEnvelope(snapshotPayload, warnings);

  const validatedBlocks = {
    purchaseItems: validatePurchaseItems(envelope.blocks.purchase_items, warnings),
    salesItems: validateSalesItems(envelope.blocks.sales_items, warnings),
    stockLive: validateStockLive(envelope.blocks.stock_live, warnings),
    purchaseOrders: validatePurchaseOrders(envelope.blocks.purchase_orders, warnings),
    salesOrders: validateSalesOrders(envelope.blocks.sales_orders, warnings),
    ordersStatus: validateOrdersStatus(envelope.blocks.orders_status, warnings),
  };

  applyCrossBlockCoherence(validatedBlocks, warnings);

  return {
    schemaVersion: envelope.schemaVersion,
    exportedAt: envelope.exportedAt,
    sourceName: envelope.sourceName,
    meta: envelope.meta,
    portalWarnings: envelope.portalWarnings,
    warnings: warnings.toArray(),
    blocks: validatedBlocks,
  };
}

module.exports = {
  ValidationError,
  parsePayloadJson,
  validatePortalSnapshot,
};
