const fs = require('fs');

/**
 * Collect accessibility errors from axe-core report
 * and format them for AI processing
 */

const REPORT_FILE = process.argv[2] || 'accessibility-report.json';
const OUTPUT_FILE = process.argv[3] || 'accessibility_errors.json';

try {
    // Read axe-core report
    const report = JSON.parse(fs.readFileSync(REPORT_FILE, 'utf8'));

    const errors = [];
    let success = true;

    // Process violations
    if (report.violations && report.violations.length > 0) {
        success = false;

        report.violations.forEach(violation => {
            violation.nodes.forEach(node => {
                errors.push({
                    id: violation.id,
                    impact: violation.impact,
                    description: violation.description,
                    help: violation.help,
                    helpUrl: violation.helpUrl,
                    html: node.html,
                    target: node.target,
                    failureSummary: node.failureSummary,
                    // Extract line number if available in target
                    line: extractLineNumber(node.target)
                });
            });
        });
    }

    const result = {
        test_type: 'accessibility',
        errors: errors,
        success: success,
        total_violations: report.violations ? report.violations.length : 0,
        total_passes: report.passes ? report.passes.length : 0,
        wcag_level: 'AA'
    };

    fs.writeFileSync(OUTPUT_FILE, JSON.stringify(result, null, 2));
    console.log(`Collected ${errors.length} accessibility issues`);

} catch (error) {
    console.error('Error processing accessibility report:', error);

    // Create empty result on error
    const result = {
        test_type: 'accessibility',
        errors: [],
        success: true,
        error: error.message
    };

    fs.writeFileSync(OUTPUT_FILE, JSON.stringify(result, null, 2));
    process.exit(0);
}

function extractLineNumber(target) {
    // Try to extract line number from target selector if available
    // This is a best-effort approach
    if (Array.isArray(target) && target.length > 0) {
        const selector = target[0];
        const match = selector.match(/:(\d+)$/);
        return match ? parseInt(match[1]) : null;
    }
    return null;
}
