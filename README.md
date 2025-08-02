# EZGangSheets - DTF Gang Sheet Generator

A powerful web application for generating DTF (Direct to Film) gang sheets with automatic cost calculation and multi-file support.

## Features

- **Multi-file Support**: Upload up to 10 PDF files at once
- **Individual Quantity Control**: Set different quantities for each file
- **Cost Calculation**: Automatic tiered pricing system
- **Flexible Dimensions**: Support for 22" and 30" width options
- **Rotation Support**: 90° rotation for logos
- **Drag & Drop Interface**: Modern, intuitive UI
- **Batch Processing**: Process all files and download all sheets
- **Real-time Cost Tracking**: See total cost for all sheets

## Cost Tiers

The application uses a tiered pricing system:
- 12": $5.28
- 24": $10.56
- 36": $15.84
- 48": $21.12
- 60": $26.40
- 80": $35.20
- 100": $44.00
- 120": $49.28
- 140": $56.32
- 160": $61.60
- 180": $68.64
- 200": $75.68

## Installation

1. **Clone or download the project**:
   ```bash
   cd ~/Desktop/EZGangSheets
   ```

2. **Install dependencies**:
   ```bash
   npm install
   ```

3. **Start the server**:
   ```bash
   npm start
   ```

4. **Open your browser** and go to:
   ```
   http://localhost:8080
   ```

## Usage

1. **Upload Files**: Drag and drop PDF files or click to select them
2. **Set Quantities**: Enter the quantity needed for each file
3. **Configure Options**:
   - Choose rotation (90° if needed)
   - Select gang sheet width (22" or 30")
   - Set maximum sheet length (default: 200")
4. **Generate**: Click "Generate All Gang Sheets"
5. **Download**: Download individual sheets or all at once

## Technical Details

### Backend (Node.js/Express)
- **PDF Processing**: Uses pdf-lib for PDF manipulation
- **File Upload**: Multer for handling file uploads
- **Cost Calculation**: Custom algorithm for tiered pricing
- **Layout Engine**: Automatic grid layout calculation

### Frontend (HTML/JavaScript)
- **UI Framework**: Tailwind CSS for styling
- **PDF Preview**: PDF.js for thumbnail generation
- **Drag & Drop**: Native HTML5 drag and drop API
- **File Handling**: Modern File API for multiple file support

### Dependencies
- `express`: Web server framework
- `multer`: File upload middleware
- `pdf-lib`: PDF manipulation library
- `cors`: Cross-origin resource sharing

## File Structure

```
EZGangSheets/
├── index.js              # Main server file
├── package.json          # Project dependencies
├── README.md            # This file
└── public/
    └── index.html       # Frontend interface
```

## Development

To modify the application:

1. **Backend Changes**: Edit `index.js`
2. **Frontend Changes**: Edit `public/index.html`
3. **Dependencies**: Update `package.json` and run `npm install`
4. **Restart**: Stop and restart the server with `npm start`

## Troubleshooting

- **Port Issues**: Change the port in `index.js` if 8080 is in use
- **File Upload Errors**: Ensure files are PDF format and under size limits
- **Cost Calculation**: Verify the cost table in `index.js` matches your pricing

## License

This project is for internal use. Please ensure compliance with any applicable licensing requirements for the libraries used.

## Support

For issues or questions, refer to the code comments or contact the development team. 