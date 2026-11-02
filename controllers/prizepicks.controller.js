import { smartGet } from "../utils/request-utils.js";

const BASE_URL = process.env.BASE_URL;

// Add this check early
if (!BASE_URL) {
    console.error("FATAL ERROR: BASE_URL environment variable is not defined.");
    // Optionally, you could prevent the app from starting fully,
    // but for now, logging is essential.
}

// We're no longer managing User-Agents here as that's handled by the request utils
// We keep the proxy list functionality for backward compatibility
let proxyList = [];
let currentProxyIndex = 0;

const loadProxies = () => {
    if (proxyList.length === 0 && process.env.PROXY_LIST) {
        proxyList = process.env.PROXY_LIST.split(',').map(p => p.trim()).filter(p => p);
        console.log(`Loaded ${proxyList.length} proxies.`);
    }
};

loadProxies(); // Load proxies when the module initializes

const getRotatingProxyConfig = () => {
    if (proxyList.length === 0) {
        return null; // No proxies configured or loaded
    }

    const proxyUrlString = proxyList[currentProxyIndex];
    currentProxyIndex = (currentProxyIndex + 1) % proxyList.length; // Rotate index

    try {
        const proxyUrl = new URL(proxyUrlString);
        const config = {
            protocol: proxyUrl.protocol.replace(':', ''), // http or https
            host: proxyUrl.hostname,
            port: parseInt(proxyUrl.port, 10),
        };
        if (proxyUrl.username && proxyUrl.password) {
            config.auth = {
                username: decodeURIComponent(proxyUrl.username),
                password: decodeURIComponent(proxyUrl.password),
            };
        }
        // console.log(`Using proxy: ${config.host}:${config.port}`); // Optional: for debugging
        return config;
    } catch (e) {
        console.error(`Error parsing proxy URL: ${proxyUrlString}`, e);
        return null; // Skip invalid proxy URL
    }
};


// --- Function to create common request options (Simplified) ---
const createRequestOptions = () => {
  // No need to select User-Agents here as the request utils handle that
  // We still set up the proxy for backward compatibility
  const proxy = getRotatingProxyConfig(); 
  
  // We return minimal options here as most browser fingerprinting
  // is now handled by the request utility
  return {
    // Any additional headers that should override the generated ones
    headers: {
      // App-specific headers if needed
    },
    ...(proxy && { proxy: proxy }) // Conditionally add the rotating proxy
  };
};


const getLeagues = async (req, res) => {
  const options = createRequestOptions();
  try {
    const fullUrl = `${BASE_URL}/leagues`;
    // Always rotate identity for this endpoint to avoid rate limiting
    const data = await smartGet(fullUrl, options, true, undefined, true);
    
    // Extract array from JSON API-format response
    const leaguesData = data.data || [];
    // Keep only active leagues
    const activeLeaguesRaw = Array.isArray(leaguesData) ? leaguesData : [];
    const filteredLeagues = activeLeaguesRaw.filter(({ attributes }) => attributes.active);
    // Restructure into a cleaner shape
    const structuredLeagues = filteredLeagues.map(({ id, attributes }) => {
      const { name, icon, image_url, projections_count } = attributes;
      return {
        id,
        name,
        icon,
        imageUrl: image_url,
        projectionsCount: projections_count
      };
    });
    return res.json({ leagues: structuredLeagues });
  } catch (error) {
    console.error("Error fetching leagues:", error.message);
    // Provide more specific status code if available from error
    const statusCode = error.response?.status || 500;
    res.status(statusCode).json({ message: "Error fetching leagues from external API" });
  }
};

const getProjections = async (req, res) => {
  const options = createRequestOptions();
  try {
    const fullUrl = `${BASE_URL}/projections?per_page=100&include_new_player_attributes=True`;
    // Set shorter cache time and always rotate identity for this endpoint
    const data = await smartGet(fullUrl, options, true, 60 * 1000, true); // 1 min cache
    
    const projectionsRaw = data.data || [];
    const included = data.included || [];
    const filteredProjections = projectionsRaw.map(({ type, id, attributes, relationships }) => {
      const {
        board_time,
        description: opponent,
        game_id,
        line_score,
        odds_type,
        projection_type,
        start_time,
        stat_display_name,
        stat_type,
        status,
        today
      } = attributes;
      const { projection_type: projectionTypeRel, score, stat_type: statTypeRel } = relationships;
      const newPlayerRel = relationships.new_player?.data;
      const newPlayerRaw = included.find(item => item.type === 'new_player' && item.id === newPlayerRel?.id);
      const mappedNewPlayer = newPlayerRaw ? (() => {
        const { market, ...otherAttrs } = newPlayerRaw.attributes;
        return {
          type: newPlayerRaw.type,
          id: newPlayerRaw.id,
          attributes: { ...otherAttrs, Team: market }
        };
      })() : null;
      return {
        type,
        id,
        attributes: {
          board_time,
          opponent,
          game_id,
          line_score,
          odds_type,
          projection_type,
          start_time,
          stat_display_name,
          stat_type,
          status,
          today
        },
        relationships: {
          new_player: mappedNewPlayer
        }
      };
    });
    return res.json({ projections: filteredProjections });
  } catch (error) {
    console.error("Error fetching projections:", error.message);
    const statusCode = error.response?.status || 500;
    if (statusCode === 429) {
        console.warn("Rate limit (429) encountered when fetching projections.");
    }
    res.status(statusCode).json({ message: "Error fetching projections from external API" });
  }
};

const getLeagueProjections = async (req, res) => {
  // Extract leagueId from the request parameters
  const leagueId = req.params.leagueId;

  // Optional: Validate if leagueId is provided and maybe if it's a number
  if (!leagueId) {
    return res.status(400).json({ message: "League ID parameter is required." });
  }

  const options = createRequestOptions(); 
  try {
    // Use the smartGet function with the full URL and force identity rotation
    const fullUrl = `${BASE_URL}/projections?league_id=${leagueId}`;
    const data = await smartGet(fullUrl, options, true, 60 * 1000, true); // 1 min cache
    
    const projectionsRaw = data.data || [];
    const included = data.included || [];
    const filteredProjections = projectionsRaw.map(({ type, id, attributes, relationships }) => {
      const {
        board_time,
        description: opponent,
        game_id,
        line_score,
        odds_type,
        projection_type,
        start_time,
        stat_display_name,
        stat_type,
        status,
        today
      } = attributes;
      const { projection_type: projectionTypeRel, score, stat_type: statTypeRel } = relationships;
      const newPlayerRel = relationships.new_player?.data;
      const newPlayerRaw = included.find(item => item.type === 'new_player' && item.id === newPlayerRel?.id);
      const mappedNewPlayer = newPlayerRaw ? (() => {
        const { market, ...otherAttrs } = newPlayerRaw.attributes;
        return {
          type: newPlayerRaw.type,
          id: newPlayerRaw.id,
          attributes: { ...otherAttrs, Team: market }
        };
      })() : null;
      return {
        type,
        id,
        attributes: { board_time, opponent, game_id, line_score, odds_type, projection_type, start_time, stat_display_name, stat_type, status, today },
        relationships: { new_player: mappedNewPlayer }
      };
    });
    return res.json({ projections: filteredProjections });
  } catch (error) {
    console.error(`Error fetching projections for league ${leagueId}:`, error.message);
    const statusCode = error.response?.status || 500;
    if (statusCode === 429) {
      console.warn(`Rate limit (429) encountered when fetching projections for league ${leagueId}.`);
    }
    // Consider adding a check for 404 Not Found if the league ID might be invalid
    if (statusCode === 404) {
        return res.status(404).json({ message: `Projections not found for league ID: ${leagueId}` });
    }
    res
      .status(statusCode)
      .json({ message: `Error fetching projections for league ${leagueId} from external API` });
  }
};

export {
  getLeagues,
  getProjections,
  getLeagueProjections,
};
