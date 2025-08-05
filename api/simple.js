module.exports = (req, res) => {
  res.json({ 
    message: "Simple test working!",
    timestamp: new Date().toISOString(),
    method: req.method,
    url: req.url
  });
};
