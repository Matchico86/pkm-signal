const { transaction } = require("../../db/queries");

function serializeJson(value) {
  return JSON.stringify(value ?? null);
}

function buildSummary(normalizedSnapshot) {
  const blockMap = {
    purchase_items: normalizedSnapshot.blocks.purchaseItems,
    sales_items: normalizedSnapshot.blocks.salesItems,
    stock_live: normalizedSnapshot.blocks.stockLive,
    purchase_orders: normalizedSnapshot.blocks.purchaseOrders,
    sales_orders: normalizedSnapshot.blocks.salesOrders,
    orders_status: normalizedSnapshot.blocks.ordersStatus,
  };

  const blocks = {};
  let totalRowsRead = 0;
  let totalRowsValid = 0;
  let totalRowsInvalid = 0;

  for (const [blockName, blockStats] of Object.entries(blockMap)) {
    blocks[blockName] = {
      rows_read: blockStats.rowsRead,
      rows_valid: blockStats.rowsValid,
      rows_invalid: blockStats.rowsInvalid,
    };

    totalRowsRead += blockStats.rowsRead;
    totalRowsValid += blockStats.rowsValid;
    totalRowsInvalid += blockStats.rowsInvalid;
  }

  return {
    blocks,
    totals: {
      rows_read: totalRowsRead,
      rows_valid: totalRowsValid,
      rows_invalid: totalRowsInvalid,
      warnings_count: normalizedSnapshot.warnings.length,
    },
  };
}

function persistPortalSnapshotRun(db, context) {
  const {
    normalizedSnapshot,
    payloadText,
    payloadHash,
    payloadOrigin,
    allowDuplicate = false,
    storeRawPayload = true,
  } = context;

  const payloadBytes = Buffer.byteLength(payloadText, "utf8");
  const summary = buildSummary(normalizedSnapshot);
  const warningsJson = serializeJson(normalizedSnapshot.warnings);
  const summaryJson = serializeJson(summary);
  const metaJson = serializeJson(normalizedSnapshot.meta);
  const portalWarningsJson = serializeJson(normalizedSnapshot.portalWarnings);

  const findSuccessfulRunByHash = db.prepare(`
    SELECT id
    FROM portal_snapshot_runs
    WHERE payload_hash = ? AND status = 'success'
    ORDER BY id DESC
    LIMIT 1;
  `);

  const insertRun = db.prepare(`
    INSERT INTO portal_snapshot_runs (
      schema_version,
      exported_at,
      source_name,
      payload_hash,
      payload_bytes,
      payload_origin,
      status,
      duplicate_of_run_id,
      warnings_json,
      summary_json,
      meta_json,
      portal_warnings_json,
      finished_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);
  `);

  const updateRunSuccess = db.prepare(`
    UPDATE portal_snapshot_runs
    SET
      status = 'success',
      warnings_json = ?,
      summary_json = ?,
      meta_json = ?,
      portal_warnings_json = ?,
      finished_at = CURRENT_TIMESTAMP
    WHERE id = ?;
  `);

  const updateRunFailed = db.prepare(`
    UPDATE portal_snapshot_runs
    SET
      status = 'failed',
      error_message = ?,
      warnings_json = ?,
      summary_json = ?,
      meta_json = ?,
      portal_warnings_json = ?,
      finished_at = CURRENT_TIMESTAMP
    WHERE id = ?;
  `);

  const insertRunPayload = db.prepare(`
    INSERT INTO portal_snapshot_run_payloads (run_id, payload_json)
    VALUES (?, ?);
  `);

  const duplicateRun = findSuccessfulRunByHash.get(payloadHash);
  if (duplicateRun && !allowDuplicate) {
    const skippedInsert = insertRun.run(
      normalizedSnapshot.schemaVersion,
      normalizedSnapshot.exportedAt,
      normalizedSnapshot.sourceName,
      payloadHash,
      payloadBytes,
      payloadOrigin,
      "skipped_duplicate",
      duplicateRun.id,
      warningsJson,
      summaryJson,
      metaJson,
      portalWarningsJson,
      new Date().toISOString()
    );

    const runId = Number(skippedInsert.lastInsertRowid);

    if (storeRawPayload) {
      insertRunPayload.run(runId, payloadText);
    }

    return {
      status: "skipped_duplicate",
      runId,
      duplicateOfRunId: duplicateRun.id,
      summary,
      warnings: normalizedSnapshot.warnings,
    };
  }

  const startedInsert = insertRun.run(
    normalizedSnapshot.schemaVersion,
    normalizedSnapshot.exportedAt,
    normalizedSnapshot.sourceName,
    payloadHash,
    payloadBytes,
    payloadOrigin,
    "started",
    null,
    null,
    null,
    null,
    null,
    null
  );

  const runId = Number(startedInsert.lastInsertRowid);

  const insertPurchaseItem = db.prepare(`
    INSERT INTO portal_purchase_items (
      run_id,
      row_index,
      p_item_id,
      p_order_id,
      card_id,
      owner,
      p_quantity,
      qty_sold,
      qty_remaining,
      qty_for_sale,
      p_price_item,
      received,
      source_sheet,
      source_row,
      raw_json
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);
  `);

  const insertSalesItem = db.prepare(`
    INSERT INTO portal_sales_items (
      run_id,
      row_index,
      s_item_id,
      s_order_id,
      p_item_id,
      card_id,
      owner,
      s_quantity,
      s_price_item,
      margin_item,
      roi_item,
      source_sheet,
      source_row,
      raw_json
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);
  `);

  const insertStockLive = db.prepare(`
    INSERT INTO portal_stock_live_snapshots (
      run_id,
      row_index,
      card_id,
      owner,
      quantity,
      qty_mathieu,
      qty_ewan,
      source_sheet,
      source_row,
      raw_json
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?);
  `);

  const insertPurchaseOrder = db.prepare(`
    INSERT INTO portal_purchase_orders (
      run_id,
      row_index,
      p_order_id,
      order_owner,
      total_amount,
      shipping_amount,
      fees_amount,
      source_sheet,
      source_row,
      raw_json
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?);
  `);

  const insertSalesOrder = db.prepare(`
    INSERT INTO portal_sales_orders (
      run_id,
      row_index,
      s_order_id,
      order_owner,
      total_amount,
      shipping_amount,
      fees_amount,
      source_sheet,
      source_row,
      raw_json
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?);
  `);

  const insertOrderStatus = db.prepare(`
    INSERT INTO portal_orders_status (
      run_id,
      row_index,
      type,
      ref_id,
      status,
      updated_at,
      source_sheet,
      source_row,
      raw_json
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?);
  `);

  try {
    transaction(db, () => {
      if (storeRawPayload) {
        insertRunPayload.run(runId, payloadText);
      }

      for (const row of normalizedSnapshot.blocks.purchaseItems.rows) {
        insertPurchaseItem.run(
          runId,
          row.rowIndex,
          row.pItemId,
          row.pOrderId,
          row.cardId,
          row.owner,
          row.pQuantity,
          row.qtySold,
          row.qtyRemaining,
          row.qtyForSale,
          row.pPriceItem,
          row.received === null ? null : row.received ? 1 : 0,
          row.sourceSheet,
          row.sourceRow,
          serializeJson(row.raw)
        );
      }

      for (const row of normalizedSnapshot.blocks.salesItems.rows) {
        insertSalesItem.run(
          runId,
          row.rowIndex,
          row.sItemId,
          row.sOrderId,
          row.pItemId,
          row.cardId,
          row.owner,
          row.sQuantity,
          row.sPriceItem,
          row.marginItem,
          row.roiItem,
          row.sourceSheet,
          row.sourceRow,
          serializeJson(row.raw)
        );
      }

      for (const row of normalizedSnapshot.blocks.stockLive.rows) {
        insertStockLive.run(
          runId,
          row.rowIndex,
          row.cardId,
          row.owner,
          row.quantity,
          row.qtyMathieu,
          row.qtyEwan,
          row.sourceSheet,
          row.sourceRow,
          serializeJson(row.raw)
        );
      }

      for (const row of normalizedSnapshot.blocks.purchaseOrders.rows) {
        insertPurchaseOrder.run(
          runId,
          row.rowIndex,
          row.pOrderId,
          row.orderOwner,
          row.totalAmount,
          row.shippingAmount,
          row.feesAmount,
          row.sourceSheet,
          row.sourceRow,
          serializeJson(row.raw)
        );
      }

      for (const row of normalizedSnapshot.blocks.salesOrders.rows) {
        insertSalesOrder.run(
          runId,
          row.rowIndex,
          row.sOrderId,
          row.orderOwner,
          row.totalAmount,
          row.shippingAmount,
          row.feesAmount,
          row.sourceSheet,
          row.sourceRow,
          serializeJson(row.raw)
        );
      }

      for (const row of normalizedSnapshot.blocks.ordersStatus.rows) {
        insertOrderStatus.run(
          runId,
          row.rowIndex,
          row.type,
          row.refId,
          row.status,
          row.updatedAt,
          row.sourceSheet,
          row.sourceRow,
          serializeJson(row.raw)
        );
      }

      updateRunSuccess.run(
        warningsJson,
        summaryJson,
        metaJson,
        portalWarningsJson,
        runId
      );
    });
  } catch (error) {
    const message = String(error.message || error).slice(0, 2000);
    updateRunFailed.run(
      message,
      warningsJson,
      summaryJson,
      metaJson,
      portalWarningsJson,
      runId
    );
    throw new Error(`Portal snapshot import failed (run_id=${runId}): ${message}`);
  }

  return {
    status: "success",
    runId,
    duplicateOfRunId: null,
    summary,
    warnings: normalizedSnapshot.warnings,
  };
}

module.exports = {
  persistPortalSnapshotRun,
};
