﻿#define DEBUG
using System;
using System.Threading.Tasks;
using Bit.Core.Contracts;
using Bit.Core.Models;
using System.Diagnostics;

namespace Bit.Owin.Implementations
{
    public class DebugLogStore : ILogStore
    {
        public virtual IContentFormatter Formatter { get; set; }

        public virtual void SaveLog(LogEntry logEntry)
        {
            if (Debugger.IsAttached)
                Debug.WriteLine(Formatter.Serialize(logEntry) + Environment.NewLine);
        }

        public virtual async Task SaveLogAsync(LogEntry logEntry)
        {
            if (Debugger.IsAttached)
                Debug.WriteLine(Formatter.Serialize(logEntry) + Environment.NewLine);
        }
    }
}
