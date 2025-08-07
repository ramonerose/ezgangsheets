# EZGangSheets Deployment Guide

## Quick Deploy Options

### Option 1: Railway (Recommended)

1. **Prepare Your Repository**
   ```bash
   # Make sure your code is committed to GitHub
   git add .
   git commit -m "Ready for deployment"
   git push origin main
   ```

2. **Deploy to Railway**
   - Go to [railway.app](https://railway.app)
   - Sign up with GitHub
   - Click "New Project" → "Deploy from GitHub repo"
   - Select your EZGangSheets repository
   - Railway will auto-detect it's a Node.js app

3. **Configure Environment Variables**
   - In Railway dashboard, go to your project
   - Click "Variables" tab
   - Add these environment variables:
     ```
     JWT_SECRET=your-super-secure-jwt-secret
     SESSION_SECRET=your-super-secure-session-secret
     ADMIN_PASSWORD=your-secure-admin-password
     ```

4. **Connect Your Domain**
   - In Railway dashboard, go to "Settings" → "Domains"
   - Click "Add Domain"
   - Enter your domain (e.g., `ezgangsheets.com`)
   - Railway will provide DNS records to add to your domain registrar

### Option 2: Vercel

1. **Deploy to Vercel**
   - Go to [vercel.com](https://vercel.com)
   - Sign up with GitHub
   - Click "New Project"
   - Import your EZGangSheets repository
   - Vercel will auto-detect the setup

2. **Configure Environment Variables**
   - In Vercel dashboard, go to "Settings" → "Environment Variables"
   - Add the same environment variables as above

3. **Connect Domain**
   - In Vercel dashboard, go to "Settings" → "Domains"
   - Add your custom domain
   - Update DNS records as instructed

### Option 3: DigitalOcean App Platform

1. **Create DigitalOcean Account**
   - Sign up at [digitalocean.com](https://digitalocean.com)

2. **Deploy App**
   - Go to "Apps" → "Create App"
   - Connect your GitHub repository
   - Select Node.js as the environment
   - Configure environment variables

3. **Connect Domain**
   - In app settings, go to "Domains"
   - Add your custom domain
   - Update DNS records

## DNS Configuration

After deploying, you'll need to update your domain's DNS records:

### For Railway:
```
Type: CNAME
Name: @
Value: your-app-name.railway.app
```

### For Vercel:
```
Type: CNAME
Name: @
Value: your-app-name.vercel.app
```

### For DigitalOcean:
```
Type: CNAME
Name: @
Value: your-app-name.ondigitalocean.app
```

## Post-Deployment Checklist

1. **Test Your App**
   - Visit your domain
   - Test user registration
   - Test gang sheet generation
   - Test admin dashboard

2. **Security Updates**
   - Change default admin password
   - Update JWT and session secrets
   - Enable HTTPS (automatic on most platforms)

3. **Monitor Performance**
   - Set up logging
   - Monitor error rates
   - Check user registrations

## Environment Variables Reference

| Variable | Description | Required |
|----------|-------------|----------|
| `PORT` | Server port | No (default: 8080) |
| `JWT_SECRET` | JWT signing secret | Yes |
| `SESSION_SECRET` | Session encryption secret | Yes |
| `ADMIN_EMAIL` | Admin account email | No (default: admin@ezgangsheets.com) |
| `ADMIN_PASSWORD` | Admin account password | Yes |

## Troubleshooting

### Common Issues:

1. **App won't start**
   - Check environment variables are set
   - Verify Node.js version (18+ required)
   - Check logs in deployment platform

2. **Domain not working**
   - Verify DNS records are correct
   - Wait for DNS propagation (up to 48 hours)
   - Check SSL certificate status

3. **File uploads failing**
   - Check file size limits
   - Verify storage permissions
   - Check network connectivity

## Support

If you encounter issues:
1. Check the deployment platform's documentation
2. Review error logs in the platform dashboard
3. Test locally to ensure the app works
4. Contact the deployment platform's support

## Next Steps After Deployment

1. **Set up monitoring** (optional)
2. **Configure backups** (if needed)
3. **Set up email notifications** (optional)
4. **Plan for scaling** as you grow 