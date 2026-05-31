const k = "qTcCNlqFVXIzEPRobyWXD9eY9CPb8xuTaWhsmywDIFrHtzUtMh6nonTF";
fetch("https://api.pexels.com/videos/search?query=battlefield+war&per_page=1", { headers: { Authorization: k } })
  .then(r => { console.log("Status:", r.status); return r.json(); })
  .then(d => { console.log("Videos:", d.videos ? d.videos.length : 0, "Total:", d.total_results); })
  .catch(e => console.error(e));
