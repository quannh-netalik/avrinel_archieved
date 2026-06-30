export const ConversationDialog = ({ messages }) => {
  return (
    <div className="flex flex-col gap-3.5 max-w-xl mx-auto">
      {messages.map((msg, i) => {
        const isRight = msg.align === "right";
        return (
          <div
            key={i}
            className={`flex gap-2.5 ${isRight ? "flex-row-reverse" : "flex-row"}`}
          >
            <div
              className={`w-8 h-8 rounded-full flex items-center justify-center font-medium text-sm flex-shrink-0 ${
                isRight
                  ? "bg-indigo-100 text-indigo-700"
                  : "bg-blue-100 text-blue-700"
              }`}
            >
              {msg.speaker[0]}
            </div>

            <div
              className={`max-w-[78%] flex flex-col ${isRight ? "items-end" : "items-start"}`}
            >
              <p className="text-xs text-gray-400 mb-1 px-0.5">{msg.speaker}</p>

              <div
                className={`rounded-lg px-3.5 py-2.5 text-sm leading-relaxed ${
                  isRight
                    ? "bg-blue-500 text-white"
                    : "bg-gray-100 text-gray-900"
                }`}
              >
                {msg.text && (
                  <p
                    className={msg.image ? "mb-2" : ""}
                    dangerouslySetInnerHTML={{ __html: msg.text }}
                  />
                )}

                {msg.image && (
                  <img
                    src={msg.image}
                    alt={msg.imageAlt || "Shared image"}
                    className="rounded-md max-w-full max-h-64 object-cover"
                  />
                )}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
};
