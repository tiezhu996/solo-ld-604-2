'use strict';

const express = require('express');
const { authRequired, requireRole } = require('../middleware/auth');
const authService = require('../services/authService');
const faultService = require('../services/faultService');
const ticketService = require('../services/ticketService');
const crewService = require('../services/crewService');
const partService = require('../services/partService');
const assetService = require('../services/assetService');
const dashboardService = require('../services/dashboardService');
const auditService = require('../services/auditService');

const router = express.Router();

// ---------- 认证 ----------
router.post('/auth/login', (req, res) => {
  res.json(authService.login(req.body.username, req.body.password));
});
router.post('/auth/logout', authRequired, (req, res) => {
  authService.logout(req.token);
  res.json({ ok: true });
});
router.get('/auth/me', authRequired, (req, res) => {
  res.json({ user: authService.publicUser(req.user) });
});

// ---------- 态势 ----------
router.get('/dashboard', authRequired, (_req, res) => {
  res.json(dashboardService.overview());
});

// ---------- 资产 ----------
router.get('/assets', authRequired, (req, res) => {
  res.json(assetService.listAssets(req.query.feeder_line));
});
router.get('/assets/feeder-lines', authRequired, (_req, res) => {
  res.json(assetService.feederLines());
});
router.get('/assets/:id/reports', authRequired, (req, res) => {
  res.json(assetService.assetFaultHistory(req.params.id));
});
router.patch('/assets/:id/health', authRequired, requireRole('dispatcher'), (req, res) => {
  res.json(assetService.updateHealth(req.user, req.params.id, req.body.health_status));
});

// ---------- 故障报修（调度员登记） ----------
router.get('/faults', authRequired, (req, res) => {
  res.json(faultService.listReports(req.query));
});
router.post('/faults', authRequired, requireRole('dispatcher'), (req, res) => {
  res.status(201).json(faultService.registerFault(req.user, req.body));
});

// ---------- 抢修工单 ----------
router.get('/tickets', authRequired, (req, res) => {
  res.json(ticketService.listTickets(req.query));
});
router.get('/tickets/:id', authRequired, (req, res) => {
  res.json(ticketService.ticketDetail(req.params.id));
});
router.post('/tickets/:id/dispatch', authRequired, requireRole('dispatcher'), (req, res) => {
  res.json(ticketService.dispatch(req.user, req.params.id, req.body.crew_id));
});
router.post('/tickets/:id/reassign', authRequired, requireRole('dispatcher'), (req, res) => {
  res.json(ticketService.reassign(req.user, req.params.id, req.body.crew_id));
});
router.post('/tickets/:id/advance', authRequired, requireRole('leader'), (req, res) => {
  res.json(ticketService.advance(req.user, req.params.id, req.body.action));
});

// ---------- 班组 ----------
router.get('/crews', authRequired, (_req, res) => {
  res.json(crewService.listCrews());
});
router.get('/crews/available', authRequired, (req, res) => {
  res.json(crewService.availability(req.query.fault_type));
});
router.patch('/crews/:id/duty', authRequired, requireRole('dispatcher'), (req, res) => {
  res.json(crewService.setDuty(req.user, req.params.id, req.body.duty_status));
});

// ---------- 备件 ----------
router.get('/parts', authRequired, (_req, res) => {
  res.json(partService.listParts());
});
router.post('/parts/:id/restock', authRequired, requireRole('keeper'), (req, res) => {
  res.json(partService.restock(req.user, req.params.id, req.body.quantity));
});
router.get('/usages', authRequired, (req, res) => {
  res.json(partService.listUsages(req.query));
});
router.post('/tickets/:id/parts', authRequired, requireRole('leader'), (req, res) => {
  res.status(201).json(partService.requestPart(req.user, req.params.id, req.body.part_id, req.body.quantity));
});
router.post('/usages/:id/approve', authRequired, requireRole('keeper'), (req, res) => {
  res.json(partService.approve(req.user, req.params.id));
});
router.post('/usages/:id/reject', authRequired, requireRole('keeper'), (req, res) => {
  res.json(partService.reject(req.user, req.params.id, req.body.reason));
});
router.post('/usages/:id/return', authRequired, requireRole('leader'), (req, res) => {
  res.json(partService.returnPart(req.user, req.params.id));
});
router.post('/usages/:id/consume', authRequired, requireRole('leader'), (req, res) => {
  res.json(partService.consume(req.user, req.params.id));
});
router.get('/stock-logs', authRequired, requireRole('keeper', 'auditor'), (req, res) => {
  res.json(partService.listStockLogs(req.query.part_id));
});

// ---------- 审计日志（仅审计员） ----------
router.get('/audit-logs', authRequired, requireRole('auditor'), (req, res) => {
  res.json(auditService.list(req.query));
});

module.exports = router;
