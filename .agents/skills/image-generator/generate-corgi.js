const https = require('https');

const apiKey = 'ENV_SILICONFLOW_API_KEY';

const payload = JSON.stringify({
  model: "Kwai-Kolors/Kolors",
  prompt: "Pembroke Welsh Corgi puppy sitting on green grass, fluffy golden fur, adorable smiling face, big ears, short legs, dappled golden sunlight, photorealistic, 4k, high detail, shallow depth of field, warm natural lighting, bokeh background",
  negative_prompt: "blurry, bad anatomy, deformed, extra limbs, low quality, watermark, text",
  image_size: "1024x1024",
  num_inference_steps: 25,
  guidance_scale: 7.5
});

const options = {
  hostname: 'api.siliconflow.cn',
  path: '/v1/images/generations',
  method: 'POST',
  headers: {
    'Authorization': `Bearer ${apiKey}`,
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(payload)
  }
};

console.log('Generating corgi image...');

const req = https.request(options, (res) => {
  let data = '';
  res.on('data', (chunk) => data += chunk);
  res.on('end', () => {
    try {
      const result = JSON.parse(data);
      if (result.data && result.data[0] && result.data[0].url) {
        const imageUrl = result.data[0].url;
        console.log('IMAGE_URL:' + imageUrl);
        
        // Download the image
        const fs = require('fs');
        const path = require('path');
        const timestamp = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 15);
        const galleryDir = path.join(process.cwd(), '.nerve', 'gallery');
        if (!fs.existsSync(galleryDir)) fs.mkdirSync(galleryDir, { recursive: true });
        const outFile = path.join(galleryDir, `corgi_${timestamp}.png`);
        
        const downloadReq = https.get(imageUrl, (downloadRes) => {
          if (downloadRes.statusCode === 301 || downloadRes.statusCode === 302) {
            // Handle redirect
            const http = require('http');
            const redirectUrl = downloadRes.headers.location;
            const protocol = redirectUrl.startsWith('https') ? https : http;
            protocol.get(redirectUrl, (redirectRes) => {
              const fileStream = fs.createWriteStream(outFile);
              redirectRes.pipe(fileStream);
              fileStream.on('finish', () => {
                fileStream.close();
                console.log('SAVED:' + outFile);
              });
            });
          } else {
            const fileStream = fs.createWriteStream(outFile);
            downloadRes.pipe(fileStream);
            fileStream.on('finish', () => {
              fileStream.close();
              console.log('SAVED:' + outFile);
            });
          }
        });
      } else {
        console.error('Error in response:', data);
      }
    } catch (e) {
      console.error('Parse error:', e.message, data);
    }
  });
});

req.on('error', (e) => console.error('Request error:', e.message));
req.write(payload);
req.end();
