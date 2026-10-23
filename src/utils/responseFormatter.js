/**
 * Standard API Response Formatter for Jamiyati API
 */

function successResponse(res, data = {}, message = 'تمت العملية بنجاح', statusCode = 200) {
  return res.status(statusCode).json({
    success: true,
    message,
    data
  });
}

function errorResponse(res, message = 'حدث خطأ في معالجة الطلب', code = 'BAD_REQUEST', statusCode = 400, details = null) {
  return res.status(statusCode).json({
    success: false,
    error: {
      code,
      message,
      details
    }
  });
}

module.exports = {
  successResponse,
  errorResponse
};
