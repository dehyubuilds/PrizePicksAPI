import express from "express";
import {
  getLeagues,
  getProjections,
  getLeagueProjections,
} from "../controllers/prizepicks.controller.js";

const router = express.Router();

router.get("/leagues", getLeagues);

router.get("/projections", getProjections);

// Add a route for specific league projections using a route parameter :leagueId
router.get("/projections/:leagueId", getLeagueProjections);

export default router;
