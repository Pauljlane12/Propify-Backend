export default async function handler(req, res) {
    if (req.method !== 'POST') {
      return res.status(405).json({ message: 'Only POST requests allowed' });
    }
  
    return res.status(200).json({ message: 'Upload endpoint is live!' });
  }
  